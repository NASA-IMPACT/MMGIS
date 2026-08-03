locals {
  # ARNs in this file are constructed from the naming convention, not module
  # references: bootstrap applies before any environment exists, and IAM
  # accepts ARNs for resources that do not exist yet.
  apply_state_bucket_arns = { for env in local.environments : env => "arn:aws:s3:::${local.state_bucket_names[env]}" }
  env_role_arn_pattern    = { for env in local.environments : env => "arn:aws:iam::${local.account_id}:role/mmgis-${env}-*" }

  # Every OIDC-trusted role this root owns. Constructed names keep the Deny
  # fence below out of a dependency cycle with the roles it protects.
  github_trusted_role_arns = [
    "arn:aws:iam::${local.account_id}:role/mmgis-terraform-apply-development",
    "arn:aws:iam::${local.account_id}:role/mmgis-terraform-apply-production",
    "arn:aws:iam::${local.account_id}:role/mmgis-terraform-plan",
    "arn:aws:iam::${local.account_id}:role/mmgis-development-github-deploy",
    "arn:aws:iam::${local.account_id}:role/mmgis-production-github-deploy",
  ]
}

# Per-environment Terraform apply role: assumed by the infrastructure apply
# workflow (#247) and, for scratch verification and break-glass, by an
# operator. Named OUTSIDE the mmgis-<env>-* namespace this role gets IAM write
# powers over; the Deny fence at the bottom is the hard guarantee that an
# automated apply can never edit the identities GitHub assumes.
resource "aws_iam_role" "terraform_apply" {
  for_each = local.environments

  name        = "mmgis-terraform-apply-${each.key}"
  description = "Terraform apply role for the ${each.key} environment. Assumed by CI through GitHub OIDC (environment-scoped) and by operators through the account root for scratch verification and break-glass."
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # The apply job binds `environment: <env>`, so its OIDC token presents
        # repo:<owner/name>:environment:<env> — a branch-ref subject would
        # fail, and renaming the GitHub Environment breaks assume outright.
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
        # Grants nothing alone — an operator still needs their own
        # sts:AssumeRole allow on this ARN. Present because the OIDC condition
        # otherwise makes the role human-unassumable, and scratch verification
        # and break-glass (README.md) require a human. The plan and deploy
        # roles deliberately do not carry this.
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
        # Objects under this environment's own key prefix only; no separator
        # before the * so the scratch keys (mmgis/<env>-scratch/) match.
        # Bucket configuration is bootstrap-owned and unreachable from here.
        Sid      = "TfStateObjects"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${local.apply_state_bucket_arns[each.key]}/mmgis/${each.key}*"
      },
      {
        # List only — no bucket-configuration writes.
        Sid      = "TfStateList"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = local.apply_state_bucket_arns[each.key]
      },
      {
        # Refresh/plan reads: these APIs are unscopeable or address
        # AWS-generated ids (honesty table: docs/infrastructure/README.md).
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
        # The environment module still declares this data source (#199 deletes
        # it); applies of the branch as it stands must not fail on the lookup.
        Sid      = "ReadGithubOidcProvider"
        Effect   = "Allow"
        Action   = ["iam:GetOpenIDConnectProvider"]
        Resource = data.aws_iam_openid_connect_provider.github.arn
      },
      {
        # No separator before the * so the scratch repo matches.
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
        # UpdateCluster/UpdateClusterSettings keep cluster drift fixable by CI
        # rather than by break-glass credentials.
        Sid    = "EcsClusterLifecycle"
        Effect = "Allow"
        Action = [
          "ecs:CreateCluster",
          "ecs:DeleteCluster",
          "ecs:UpdateCluster",
          "ecs:UpdateClusterSettings",
        ]
        Resource = "arn:aws:ecs:${local.region}:${local.account_id}:cluster/mmgis-${each.key}*"
      },
      {
        # ECS authorizes TagResource against the resource being created, and
        # provider default_tags ride every create call — miss one ARN shape and
        # apply dies with an AccessDenied that never mentions tags.
        Sid    = "EcsTagging"
        Effect = "Allow"
        Action = ["ecs:TagResource", "ecs:UntagResource"]
        Resource = [
          "arn:aws:ecs:${local.region}:${local.account_id}:cluster/mmgis-${each.key}*",
          "arn:aws:ecs:${local.region}:${local.account_id}:task-definition/mmgis-${each.key}*",
          "arn:aws:ecs:${local.region}:${local.account_id}:task-definition/mmgis-${each.key}*:*",
          "arn:aws:ecs:${local.region}:${local.account_id}:service/mmgis-${each.key}*/*",
          "arn:aws:ecs:${local.region}:${local.account_id}:express-gateway-service/*",
        ]
      },
      {
        # Register/DeregisterTaskDefinition support no resource-level scoping
        # (empirically confirmed); the mmgis-<env>- family-name convention is
        # what keeps environments' revisions apart.
        Sid      = "TaskDefinitionsUnscopeable"
        Effect   = "Allow"
        Action   = ["ecs:RegisterTaskDefinition", "ecs:DeregisterTaskDefinition"]
        Resource = "*"
      },
      {
        # The API authorizes Update/Describe against the SERVICE ARN (learned
        # empirically) and the express-gateway-service/* shape elsewhere, so
        # both are listed. Express gateway service ids are ECS-generated.
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
        # The second ARN form (with :*) is the shape several logs APIs
        # authorize against.
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
        # CreateDBInstance authorizes against BOTH the db and subnet-group
        # ARNs. No secretsmanager grant is needed for
        # manage_master_user_password: RDS creates and rotates the managed
        # master secret itself, under its own service principal.
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
        # Security group ids are EC2-generated and the VPC id is an uncommitted
        # per-account input, so no honest resource pattern exists — * plus this
        # exact allowlist is the documented trade (docs/infrastructure/README.md). Includes the
        # phase-2 ingress rule on the ECS-managed ALB security group.
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
        # Two patterns because the scratch bucket
        # (mmgis-development-scratch-assets-*) cannot share one with the real
        # bucket; neither matches a -tfstate- bucket. Bucket ARNs only, no
        # object ARNs: Terraform manages configuration, never contents.
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
        # Distribution, VPC-origin and origin-access-control ids are
        # CloudFront-generated (and CloudFront ARNs are global, not regional),
        # so nothing here can be name-scoped. Reads live in ReadOnlyDiscovery.
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
        # Secrets are PATH-style (mmgis/<env>/db, …), a different convention
        # from the mmgis-<env>-* prefix; no separator before the * so the
        # scratch environment and the random -XXXXXX ARN suffix match.
        # PutSecretValue serves the CI secret bootstrap (#248). GetSecretValue
        # is deliberately absent: CI never reads a secret value, and the
        # plan/apply path must not be able to exfiltrate one.
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
        # A CreateRole without exactly this environment's boundary is denied,
        # so every CI-created role is capped by boundary.tf whether the module
        # remembers to ask or not (#199 owns the module half of the contract).
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
        # CreateRole is conditioned above; UpdateAssumeRolePolicy is absent —
        # CI never edits trust policies (and the fence below denies it besides).
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
        # Pinned to the ONE managed policy the module attaches — a role that
        # can attach any AWS managed policy can attach AdministratorAccess.
        # (The lowercase "for" in the policy name is correct.)
        Sid      = "AttachExpressInfraManagedPolicyOnly"
        Effect   = "Allow"
        Action   = ["iam:AttachRolePolicy", "iam:DetachRolePolicy"]
        Resource = local.env_role_arn_pattern[each.key]
        Condition = {
          StringEquals = {
            "iam:PolicyARN" = "arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRoleforExpressGatewayServices"
          }
        }
      },
      {
        # Same condition as CreateRole: repairs may only ever re-set THIS
        # environment's boundary, never a weaker or foreign one.
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
      # The escalation fence: an automated apply may create roles but never
      # edit the identities GitHub assumes. A boundary cannot express that
      # (boundaries do not constrain trust-policy edits), so it is an explicit
      # Deny that overrides every Allow above — including the mmgis-<env>-*
      # grants that DO cover the deploy role's name.
      {
        # Everything except these reads is denied against the OIDC-trusted
        # roles. Reads stay purely for incident-response debuggability.
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
        # touching a role. BOTH environments' boundaries are denied to both
        # apply roles — else dev could rewrite production's cap.
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
        # Stripping the boundary off a role is the other way around the cap —
        # never legitimate for CI, on any role in the account.
        Sid      = "FenceOffBoundaryRemoval"
        Effect   = "Deny"
        Action   = ["iam:DeleteRolePermissionsBoundary"]
        Resource = "arn:aws:iam::${local.account_id}:role/*"
      },
    ]
  })
}
