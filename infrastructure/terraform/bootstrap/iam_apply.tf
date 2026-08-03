locals {
  # Every ARN in this file is CONSTRUCTED from the naming convention rather than
  # referenced off the environment module: bootstrap applies long before any
  # environment exists, and IAM happily accepts ARNs for resources that do not
  # exist yet. The convention IS the contract — see README.md.
  apply_state_bucket_arns = { for env in local.environments : env => "arn:aws:s3:::${local.state_bucket_names[env]}" }
  env_role_arn_pattern    = { for env in local.environments : env => "arn:aws:iam::${local.account_id}:role/mmgis-${env}-*" }

  # Every OIDC-trusted role this root owns, both environments, by constructed
  # name. The escalation fence Denies against this exact list; constructing the
  # ARNs instead of referencing the resources keeps the fence out of a
  # dependency cycle with the roles it protects.
  github_trusted_role_arns = [
    "arn:aws:iam::${local.account_id}:role/mmgis-terraform-apply-development",
    "arn:aws:iam::${local.account_id}:role/mmgis-terraform-apply-production",
    "arn:aws:iam::${local.account_id}:role/mmgis-terraform-plan",
    "arn:aws:iam::${local.account_id}:role/mmgis-development-github-deploy",
    "arn:aws:iam::${local.account_id}:role/mmgis-production-github-deploy",
  ]
}

# Per-environment Terraform apply role: assumed by the infrastructure apply
# workflow (#247) and, for the scratch verification and break-glass paths in
# README.md, by a human operator.
#
# The role name deliberately sits OUTSIDE the mmgis-<env>-* namespace this role
# gets IAM write powers over. That is defense in depth #1 — the Allow statements
# below cannot even name a GitHub-trusted role. Defense #2 is the explicit Deny
# fence at the bottom of the inline policy, which is what actually guarantees
# that an automated apply can never edit the identities GitHub assumes.
resource "aws_iam_role" "terraform_apply" {
  for_each = local.environments

  name        = "mmgis-terraform-apply-${each.key}"
  description = "Terraform apply role for the ${each.key} environment. Assumed by CI through GitHub OIDC (environment-scoped) and by operators through the account root for scratch verification and break-glass."
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Environment-form subject: the apply job binds `environment: <env>` at
        # job level, so its OIDC token presents
        # repo:<owner/name>:environment:<env>. A branch-ref subject would fail on
        # first use, and renaming the GitHub Environment breaks assume outright.
        Sid       = "GitHubOidcEnvironmentScoped"
        Effect    = "Allow"
        Principal = { Federated = data.aws_iam_openid_connect_provider.github.arn }
        Action    = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = local.oidc_aud
            "token.actions.githubusercontent.com:sub" = local.environment_subs[each.key]
          }
        }
      },
      {
        # Account-root trust only DELEGATES to per-principal IAM: it grants
        # nothing by itself, because an operator still needs their own
        # sts:AssumeRole allow on this role ARN. It exists because the OIDC
        # condition above otherwise makes the role unassumable by any human, and
        # the documented scratch verification and break-glass apply both require
        # a human to hold it. No external surface is added. The plan and deploy
        # roles deliberately do NOT carry this statement — nothing requires a
        # human to hold those.
        Sid       = "OperatorAssumeForScratchAndBreakGlass"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${local.account_id}:root" }
        Action    = "sts:AssumeRole"
      },
    ]
  })
}

resource "aws_iam_role_policy" "terraform_apply" {
  for_each = local.environments

  name = "mmgis-terraform-apply-${each.key}"
  role = aws_iam_role.terraform_apply[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Object operations only, and only under this environment's own key
        # prefix: mmgis/<env>/terraform.tfstate, its .tflock lock object, and
        # the documented scratch prefix mmgis/<env>-scratch/. There is no
        # separator before the trailing * precisely so the scratch keys match.
        # Bucket CONFIGURATION is bootstrap-owned and unreachable from here.
        Sid      = "TfStateObjects"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${local.apply_state_bucket_arns[each.key]}/mmgis/${each.key}*"
      },
      {
        # Terraform lists the bucket on init/refresh. Note what is NOT here: no
        # PutBucket*, no DeleteBucket, no versioning or encryption writes — the
        # state bucket's configuration belongs to this root alone.
        Sid      = "TfStateList"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = local.apply_state_bucket_arns[each.key]
      },
      {
        # Terraform refresh/plan reads. These are list/describe APIs that are
        # either unscopeable or whose ids are generated by AWS (security groups,
        # CloudFront distributions, VPC origins, origin access controls), so no
        # honest resource pattern exists — the per-service honesty table in
        # README.md records exactly which is which.
        # elasticloadbalancing:Describe* also serves the phase-2 Express-ALB
        # discovery the deploy engine performs under this role.
        Sid    = "ReadOnlyDiscovery"
        Effect = "Allow"
        Action = [
          "ec2:Describe*",
          "elasticloadbalancing:Describe*",
          "rds:Describe*",
          "ecs:Describe*",
          "ecs:List*",
          "ecr:Describe*",
          "logs:Describe*",
          "cloudfront:Get*",
          "cloudfront:List*",
        ]
        Resource = "*"
      },
      {
        # Repository name is mmgis-<env>; the trailing * with no separator also
        # covers the scratch environment's repo (mmgis-development-scratch).
        Sid    = "EcrRepoLifecycle"
        Effect = "Allow"
        Action = [
          "ecr:CreateRepository",
          "ecr:DeleteRepository",
          "ecr:PutImageScanningConfiguration",
          "ecr:PutImageTagMutability",
          "ecr:TagResource",
          "ecr:UntagResource",
          "ecr:ListTagsForResource",
        ]
        Resource = "arn:aws:ecr:${local.region}:${local.account_id}:repository/mmgis-${each.key}*"
      },
      {
        Sid    = "EcsClusterLifecycle"
        Effect = "Allow"
        Action = [
          "ecs:CreateCluster",
          "ecs:DeleteCluster",
          "ecs:TagResource",
          "ecs:UntagResource",
        ]
        Resource = "arn:aws:ecs:${local.region}:${local.account_id}:cluster/mmgis-${each.key}*"
      },
      {
        # RegisterTaskDefinition / DeregisterTaskDefinition support no
        # resource-level scoping (empirically confirmed while building the
        # environment module), so they authorize against *. Family names still
        # carry the mmgis-<env>- prefix by module convention, which is what stops
        # a production revision from being picked up by development's
        # publish-by-family flow.
        Sid      = "TaskDefinitionsUnscopeable"
        Effect   = "Allow"
        Action   = ["ecs:RegisterTaskDefinition", "ecs:DeregisterTaskDefinition"]
        Resource = "*"
      },
      {
        # The Express gateway service API authorizes Update/Describe against the
        # SERVICE ARN (learned empirically in the module) and against the
        # express-gateway-service/* shape elsewhere, so both are listed. Express
        # gateway service ids are generated by ECS — allowlist honesty in
        # README.md.
        Sid    = "ExpressGatewayServiceLifecycle"
        Effect = "Allow"
        Action = [
          "ecs:CreateExpressGatewayService",
          "ecs:UpdateExpressGatewayService",
          "ecs:DeleteExpressGatewayService",
          "ecs:DescribeExpressGatewayService",
        ]
        Resource = [
          "arn:aws:ecs:${local.region}:${local.account_id}:express-gateway-service/*",
          "arn:aws:ecs:${local.region}:${local.account_id}:service/mmgis-${each.key}*/*",
        ]
      },
      {
        # Log groups are /ecs/mmgis-<env>-admin and /ecs/mmgis-<env>-publish. The
        # second ARN form (with :*) is the one several logs APIs authorize
        # against.
        Sid    = "LogGroupLifecycle"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:DeleteLogGroup",
          "logs:PutRetentionPolicy",
          "logs:TagResource",
          "logs:UntagResource",
          "logs:ListTagsForResource",
          "logs:ListTagsLogGroup",
        ]
        Resource = [
          "arn:aws:logs:${local.region}:${local.account_id}:log-group:/ecs/mmgis-${each.key}*",
          "arn:aws:logs:${local.region}:${local.account_id}:log-group:/ecs/mmgis-${each.key}*:*",
        ]
      },
      {
        # CreateDBInstance authorizes against BOTH the db and the subnet-group
        # ARN, so both patterns are listed here.
        #
        # On manage_master_user_password: RDS creates and rotates the managed
        # master secret ITSELF, under the rds service principal — no caller-side
        # secretsmanager grant is expected or given. Confirmed by the scratch
        # apply in README.md.
        Sid    = "RdsLifecycle"
        Effect = "Allow"
        Action = [
          "rds:CreateDBInstance",
          "rds:DeleteDBInstance",
          "rds:ModifyDBInstance",
          "rds:AddTagsToResource",
          "rds:RemoveTagsFromResource",
          "rds:ListTagsForResource",
        ]
        Resource = [
          "arn:aws:rds:${local.region}:${local.account_id}:db:mmgis-${each.key}*",
          "arn:aws:rds:${local.region}:${local.account_id}:subgrp:mmgis-${each.key}*",
        ]
      },
      {
        Sid    = "RdsSubnetGroupLifecycle"
        Effect = "Allow"
        Action = [
          "rds:CreateDBSubnetGroup",
          "rds:DeleteDBSubnetGroup",
          "rds:ModifyDBSubnetGroup",
        ]
        Resource = "arn:aws:rds:${local.region}:${local.account_id}:subgrp:mmgis-${each.key}*"
      },
      {
        # Security group ids are generated by EC2 and the VPC id is an
        # uncommitted per-account input, so no honest resource pattern exists.
        # Resource "*" plus this exact action allowlist is the documented trade
        # (honesty table in README.md). Includes the phase-2 ingress rule the
        # module adds to the ECS-managed ALB security group.
        Sid    = "SecurityGroups"
        Effect = "Allow"
        Action = [
          "ec2:CreateSecurityGroup",
          "ec2:DeleteSecurityGroup",
          "ec2:AuthorizeSecurityGroupIngress",
          "ec2:AuthorizeSecurityGroupEgress",
          "ec2:RevokeSecurityGroupIngress",
          "ec2:RevokeSecurityGroupEgress",
          "ec2:ModifySecurityGroupRules",
          "ec2:CreateTags",
          "ec2:DeleteTags",
        ]
        Resource = "*"
      },
      {
        # Two patterns because the scratch environment's bucket
        # (mmgis-development-scratch-assets-<account_id>) cannot share a single
        # pattern with the real one (mmgis-development-assets-<account_id>).
        # Neither matches a mmgis-<env>-tfstate-<account_id> bucket.
        #
        # Bucket ARNs only, no object ARNs: Terraform manages the bucket and its
        # configuration, never its contents. s3:Get* here reads bucket config.
        Sid    = "AssetsBucketLifecycle"
        Effect = "Allow"
        Action = [
          "s3:CreateBucket",
          "s3:DeleteBucket",
          "s3:ListBucket",
          "s3:Get*",
          "s3:PutBucketPolicy",
          "s3:DeleteBucketPolicy",
          "s3:PutBucketTagging",
          "s3:PutBucketPublicAccessBlock",
          "s3:PutEncryptionConfiguration",
          "s3:PutBucketVersioning",
        ]
        Resource = [
          "arn:aws:s3:::mmgis-${each.key}-assets-*",
          "arn:aws:s3:::mmgis-${each.key}-*-assets-*",
        ]
      },
      {
        # Distribution, VPC-origin and origin-access-control ids are generated by
        # CloudFront, so nothing here can be name-scoped; the read half (Get*,
        # List*) lives in ReadOnlyDiscovery. CloudFront ARNs are also global
        # rather than regional, which the * accommodates. Allowlist honesty in
        # README.md.
        Sid    = "CloudFrontLifecycle"
        Effect = "Allow"
        Action = [
          "cloudfront:CreateDistribution",
          "cloudfront:UpdateDistribution",
          "cloudfront:DeleteDistribution",
          "cloudfront:TagResource",
          "cloudfront:UntagResource",
          "cloudfront:CreateVpcOrigin",
          "cloudfront:UpdateVpcOrigin",
          "cloudfront:DeleteVpcOrigin",
          "cloudfront:CreateOriginAccessControl",
          "cloudfront:UpdateOriginAccessControl",
          "cloudfront:DeleteOriginAccessControl",
        ]
        Resource = "*"
      },
      {
        # Three things worth knowing about this one pattern:
        #
        # (a) Secrets are PATH-style — mmgis/<env>/db, mmgis/<env>/session-secret,
        #     … — a DIFFERENT convention from the mmgis-<env>-* resource prefix
        #     used everywhere else. Carry it explicitly or every secret operation
        #     fails.
        # (b) No trailing slash before the *, so the documented scratch
        #     environment (mmgis/development-scratch/…) is covered too. The same
        #     wildcard absorbs the random -XXXXXX suffix Secrets Manager appends
        #     to every secret ARN.
        # (c) PutSecretValue is here for the CI secret bootstrap (#248), which
        #     generates a value into a freshly created empty shell.
        #     GetSecretValue is deliberately ABSENT: CI never needs to read a
        #     secret value, and the plan/apply path must not be able to
        #     exfiltrate one.
        Sid    = "SecretShells"
        Effect = "Allow"
        Action = [
          "secretsmanager:CreateSecret",
          "secretsmanager:DeleteSecret",
          "secretsmanager:DescribeSecret",
          "secretsmanager:UpdateSecret",
          "secretsmanager:TagResource",
          "secretsmanager:UntagResource",
          "secretsmanager:GetResourcePolicy",
          "secretsmanager:PutSecretValue",
        ]
        Resource = "arn:aws:secretsmanager:${local.region}:${local.account_id}:secret:mmgis/${each.key}*"
      },
      {
        # THE boundary-condition enforcement. A CreateRole that supplies no
        # permissions boundary — or any boundary other than THIS environment's —
        # is denied outright, so every role CI creates is capped by boundary.tf
        # whether the module remembers to ask for it or not. The environment
        # module must therefore attach this exact boundary to every role it
        # creates; its amendments issue (#199) owns that half of the contract.
        Sid      = "CreateRoleOnlyWithBoundary"
        Effect   = "Allow"
        Action   = ["iam:CreateRole"]
        Resource = local.env_role_arn_pattern[each.key]
        Condition = {
          StringEquals = {
            "iam:PermissionsBoundary" = aws_iam_policy.ci_role_boundary[each.key].arn
          }
        }
      },
      {
        # The rest of the role lifecycle, scoped to the environment's own name
        # prefix. Note the absence of CreateRole (it is conditioned above) and of
        # UpdateAssumeRolePolicy — CI has no business editing any trust policy,
        # and the fence below denies it besides.
        Sid    = "RoleLifecycle"
        Effect = "Allow"
        Action = [
          "iam:DeleteRole",
          "iam:GetRole",
          "iam:UpdateRole",
          "iam:UpdateRoleDescription",
          "iam:TagRole",
          "iam:UntagRole",
          "iam:ListRolePolicies",
          "iam:ListAttachedRolePolicies",
          "iam:ListInstanceProfilesForRole",
          "iam:ListRoleTags",
          "iam:GetRolePolicy",
          "iam:PutRolePolicy",
          "iam:DeleteRolePolicy",
        ]
        Resource = local.env_role_arn_pattern[each.key]
      },
      {
        # The module attaches exactly one AWS managed policy — the Express
        # infrastructure role's. Customer-managed policy attachment is not
        # needed, so it is not granted, and any role decorated this way is still
        # capped by the boundary.
        Sid      = "AttachAwsManagedPoliciesOnly"
        Effect   = "Allow"
        Action   = ["iam:AttachRolePolicy", "iam:DetachRolePolicy"]
        Resource = local.env_role_arn_pattern[each.key]
        Condition = {
          ArnLike = {
            "iam:PolicyARN" = "arn:aws:iam::aws:policy/*"
          }
        }
      },
      {
        # Terraform may re-set or repair a role's boundary, but the same
        # condition means it can only ever set THIS environment's boundary —
        # never a weaker one, and never the other environment's.
        Sid      = "ReaffirmBoundaryOnly"
        Effect   = "Allow"
        Action   = ["iam:PutRolePermissionsBoundary"]
        Resource = local.env_role_arn_pattern[each.key]
        Condition = {
          StringEquals = {
            "iam:PermissionsBoundary" = aws_iam_policy.ci_role_boundary[each.key].arn
          }
        }
      },
      {
        # Creating the task definitions and the Express service passes the
        # execution, task and infrastructure roles to ECS.
        Sid      = "PassRuntimeRolesToEcs"
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = local.env_role_arn_pattern[each.key]
        Condition = {
          StringEquals = {
            "iam:PassedToService" = ["ecs-tasks.amazonaws.com", "ecs.amazonaws.com"]
          }
        }
      },
      # ── The escalation fence ──────────────────────────────────────────────
      #
      # The design rule the whole bootstrap/environment split exists to enforce:
      # an automated apply may create IAM roles, but it may NEVER edit the
      # identities GitHub itself assumes. A permissions boundary cannot express
      # that — boundaries do not constrain trust-policy edits — so the fence is
      # an explicit Deny, which overrides every Allow above, including the
      # role/mmgis-<env>-* grants that DO cover the deploy role's name.
      {
        # NotAction + Deny: every iam action EXCEPT these reads is denied against
        # the five OIDC-trusted roles. UpdateAssumeRolePolicy, PutRolePolicy,
        # DeleteRole, AttachRolePolicy, PassRole, TagRole — all of it, gone.
        #
        # Reads stay allowed purely for debuggability (an `aws iam get-role`
        # during incident response under the apply role's session); nothing in
        # this root's state references these roles from an environment root.
        Sid    = "FenceOffGitHubTrustedRoles"
        Effect = "Deny"
        NotAction = [
          "iam:GetRole",
          "iam:GetRolePolicy",
          "iam:ListRolePolicies",
          "iam:ListAttachedRolePolicies",
          "iam:ListRoleTags",
          "iam:ListInstanceProfilesForRole",
        ]
        Resource = local.github_trusted_role_arns
      },
      {
        # Editing a boundary's default version would gut the cap without
        # touching a single role, so the boundary policies themselves are off
        # limits — BOTH of them, to either apply role. Denying only this
        # environment's would let the development apply role rewrite
        # production's cap, which is exactly the cross-environment reach the
        # per-environment split exists to remove.
        Sid    = "FenceOffBoundaryPolicy"
        Effect = "Deny"
        Action = [
          "iam:CreatePolicyVersion",
          "iam:DeletePolicy",
          "iam:DeletePolicyVersion",
          "iam:SetDefaultPolicyVersion",
        ]
        Resource = [for env in local.environments : aws_iam_policy.ci_role_boundary[env].arn]
      },
      {
        # Stripping the boundary off a CI-created role is the other way around
        # the cap. It is never legitimate for CI, on any role in the account.
        Sid      = "FenceOffBoundaryRemoval"
        Effect   = "Deny"
        Action   = ["iam:DeleteRolePermissionsBoundary"]
        Resource = "arn:aws:iam::${local.account_id}:role/*"
      },
    ]
  })
}
