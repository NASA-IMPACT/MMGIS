# Read-only role for PR plan previews (iac-plan.yml). The plan job runs UNBOUND (no
# `environment:`) so its OIDC subject is repo:<owner/name>:pull_request —
# binding an environment would park a mere PR check behind production's
# required-reviewer gate. One role covers both environments' roots. Fork PRs
# get no OIDC token, so no preview (accepted). Named outside mmgis-<env>-* so
# the apply roles' IAM grants cannot reach it. Identity model: docs/infrastructure/README.md.

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
        # Plans run with -lock=false, so no lock-object write is granted. The
        # bootstrap bucket is deliberately absent.
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
        # Same as the apply role's discovery statement: unscopeable APIs or
        # AWS-generated ids (honesty table: docs/infrastructure/identity.md).
        Sid    = "ReadOnlyDiscovery"
        Effect = "Allow"
        Action = [
          "ec2:Describe*",
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
        # Read-only lookup of the GitHub OIDC provider, so a plan of any
        # root that declares the data source never fails on the read.
        Sid      = "ReadGithubOidcProvider"
        Effect   = "Allow"
        Action   = ["iam:GetOpenIDConnectProvider"]
        Resource = data.aws_iam_openid_connect_provider.github.arn
      },
      {
        # The environment module resolves the RDS master-secret key (kms.tf) by
        # alias through a data source, so a plan of any environment root fails
        # on the read without this. DescribeKey by alias authorizes against the
        # key itself, which keeps the grant scoped to the one key.
        Sid      = "ReadMasterSecretKey"
        Effect   = "Allow"
        Action   = ["kms:DescribeKey"]
        Resource = aws_kms_key.master_secret.arn
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
        # Asset-bucket CONFIGURATION for the plan diff, not contents. The
        # tfstate buckets' configuration is bootstrap-owned; no CI role reads it.
        Sid      = "ReadAssetBucketsConfig"
        Effect   = "Allow"
        Action   = ["s3:Get*", "s3:ListBucket"]
        Resource = "arn:aws:s3:::mmgis-*-assets-*"
      },
      {
        # GetSecretValue is deliberately absent: a hijacked PR workflow must
        # not read a secret value, and metadata is all a plan diff needs.
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
    ]
  })
}
