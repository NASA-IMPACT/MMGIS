# The read-only role assumed by the PR plan-preview workflow (#246).
#
# TRUST-SUBJECT DECISION, taken jointly with that issue: the plan job runs
# UNBOUND — it declares no `environment:` — because binding one would flip the
# OIDC subject to the environment form and, for production, park a mere PR check
# behind the required-reviewer gate. Unbound pull_request jobs present
# repo:<owner/name>:pull_request, so that exact subject is what this role trusts.
# Fork PRs on a public repo get no OIDC token at all, so an outside
# contributor's infrastructure PR gets no preview; that is accepted, and the
# workflow explains itself with a neutral notice.
#
# ONE role covers BOTH environments' roots: a preview plans both, and read
# powers this narrow do not justify two trust anchors. The name sits outside the
# mmgis-<env>-* namespace so the apply roles' IAM grants cannot reach it even
# before the Deny fence in iam_apply.tf applies.
#
# Read-only is enforced BY CONSTRUCTION: no write action appears anywhere below.
# The deliberate mutation-denial check is in README.md's verified-at-apply-time
# list.

locals {
  plan_state_object_arns = [for env in local.environments : "arn:aws:s3:::${local.state_bucket_names[env]}/mmgis/*"]
  plan_state_bucket_arns = [for env in local.environments : "arn:aws:s3:::${local.state_bucket_names[env]}"]
}

resource "aws_iam_role" "terraform_plan" {
  name        = "mmgis-terraform-plan"
  description = "Read-only Terraform plan role for PR plan previews. Trusted only by the unbound pull_request OIDC subject; holds no write action against anything."
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "GitHubOidcPullRequestScoped"
      Effect    = "Allow"
      Principal = { Federated = data.aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = local.oidc_aud
          "token.actions.githubusercontent.com:sub" = local.pull_request_sub
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "terraform_plan" {
  name = "mmgis-terraform-plan"
  role = aws_iam_role.terraform_plan.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Plans run with -lock=false, so no lock object is ever written and no
        # write permission is granted to make one. The bootstrap bucket is
        # deliberately absent: nothing CI-facing needs this root's state.
        Sid      = "ReadStateObjects"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = local.plan_state_object_arns
      },
      {
        Sid      = "ListStateBuckets"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = local.plan_state_bucket_arns
      },
      {
        # Identical to the apply role's discovery statement, for the same
        # reason: these reads are either unscopeable or address AWS-generated
        # ids. See the per-service honesty table in README.md.
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
        # DescribeTaskDefinition supports no resource-level scoping.
        Sid      = "ReadTaskDefinitions"
        Effect   = "Allow"
        Action   = ["ecs:DescribeTaskDefinition"]
        Resource = "*"
      },
      {
        Sid      = "ReadEcrConfig"
        Effect   = "Allow"
        Action   = ["ecr:ListTagsForResource"]
        Resource = "arn:aws:ecr:${local.region}:${local.account_id}:repository/mmgis-*"
      },
      {
        Sid    = "ReadLogTags"
        Effect = "Allow"
        Action = ["logs:ListTagsForResource", "logs:ListTagsLogGroup"]
        Resource = [
          "arn:aws:logs:${local.region}:${local.account_id}:log-group:/ecs/mmgis-*",
          "arn:aws:logs:${local.region}:${local.account_id}:log-group:/ecs/mmgis-*:*",
        ]
      },
      {
        Sid    = "ReadRdsTags"
        Effect = "Allow"
        Action = ["rds:ListTagsForResource"]
        Resource = [
          "arn:aws:rds:${local.region}:${local.account_id}:db:mmgis-*",
          "arn:aws:rds:${local.region}:${local.account_id}:subgrp:mmgis-*",
        ]
      },
      {
        # Bucket ARNs only — this reads the asset buckets' CONFIGURATION for the
        # plan diff, not their contents. Note this is NOT the tfstate buckets:
        # their objects are covered above and their configuration is
        # bootstrap-owned, so no CI role reads it.
        Sid      = "ReadAssetBucketsConfig"
        Effect   = "Allow"
        Action   = ["s3:Get*", "s3:ListBucket"]
        Resource = "arn:aws:s3:::mmgis-*-assets-*"
      },
      {
        # secretsmanager:GetSecretValue is DELIBERATELY ABSENT. A hijacked PR
        # workflow must not be able to read a single secret value; metadata is
        # all a plan diff needs, because the module manages shells and never
        # values.
        Sid      = "ReadSecretMetadata"
        Effect   = "Allow"
        Action   = ["secretsmanager:DescribeSecret", "secretsmanager:GetResourcePolicy"]
        Resource = "arn:aws:secretsmanager:${local.region}:${local.account_id}:secret:mmgis/*"
      },
      {
        Sid    = "ReadRuntimeRoles"
        Effect = "Allow"
        Action = [
          "iam:GetRole",
          "iam:GetRolePolicy",
          "iam:ListRolePolicies",
          "iam:ListAttachedRolePolicies",
          "iam:ListRoleTags",
          "iam:ListInstanceProfilesForRole",
        ]
        Resource = "arn:aws:iam::${local.account_id}:role/mmgis-*"
      },
      {
        # The module reads the boundary policy it attaches, so a plan of the
        # module needs to read it too.
        Sid      = "ReadBoundaryPolicy"
        Effect   = "Allow"
        Action   = ["iam:GetPolicy", "iam:GetPolicyVersion", "iam:ListPolicyVersions"]
        Resource = [for env in local.environments : aws_iam_policy.ci_role_boundary[env].arn]
      },
    ]
  })
}
