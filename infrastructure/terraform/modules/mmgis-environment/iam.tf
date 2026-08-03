# Task, execution, and infrastructure roles. Translated from
# infrastructure/iam/*.json — every statement is production-tested. Names are
# per-environment; cross-references (PassRole targets, RunTask family) resolve
# through Terraform attributes rather than literal ARNs where possible.

locals {
  ecr_repo_arn = aws_ecr_repository.this.arn

  # The RDS-managed master secret must be an ATTRIBUTE reference, never a
  # literal ARN: the secret does not exist until the DB does, so a literal
  # would break a greenfield apply.
  admin_exec_secret_arns = [
    aws_db_instance.this.master_user_secret[0].secret_arn,
    aws_secretsmanager_secret.session.arn,
    aws_secretsmanager_secret.seed_username.arn,
    aws_secretsmanager_secret.seed_password.arn,
  ]

  publish_exec_secret_arns = [
    aws_db_instance.this.master_user_secret[0].secret_arn,
    aws_secretsmanager_secret.dashboards_password.arn,
  ]

  ecs_tasks_assume_role = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowEcsTasksAssume"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = { StringEquals = { "aws:SourceAccount" = local.account_id } }
    }]
  })
}

# ── Admin execution role (image pull, logs, secret injection) ──
resource "aws_iam_role" "admin_exec" {
  name                 = "${local.name_prefix}-admin-task-execution"
  description          = "ECS-side role for the ${local.admin_family} task: pull image, write logs, inject admin secrets[]. Lean deployment only."
  assume_role_policy   = local.ecs_tasks_assume_role
  permissions_boundary = var.permissions_boundary
}

resource "aws_iam_role_policy" "admin_exec" {
  name = "${local.name_prefix}-admin-task-execution"
  role = aws_iam_role.admin_exec.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # ecr:GetAuthorizationToken supports NO resource scoping; it authorizes
        # against * by design (mirrors AmazonECSTaskExecutionRolePolicy) and
        # returns only a registry auth token, no repository data access.
        Sid      = "EcrAuthTokenNoResourceScoping"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid      = "EcrPullImage"
        Effect   = "Allow"
        Action   = ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"]
        Resource = local.ecr_repo_arn
      },
      {
        Sid      = "CloudWatchLogsWrite"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.admin.arn}:*"
      },
      {
        Sid      = "InjectAdminTaskSecrets"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = local.admin_exec_secret_arns
      },
    ]
  })
}

# ── Admin task role (runtime container code) ──
resource "aws_iam_role" "admin_task" {
  name                 = "${local.name_prefix}-admin-task"
  description          = "Runtime role for the ${local.admin_family} container: RunTask + PassRole of the publish roles, dashboard stack read/delete + teardown, admin asset upload. Lean deployment only."
  assume_role_policy   = local.ecs_tasks_assume_role
  permissions_boundary = var.permissions_boundary
}

resource "aws_iam_role_policy" "admin_task" {
  name = "${local.name_prefix}-admin-task"
  role = aws_iam_role.admin_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "RunPublishTask"
        Effect   = "Allow"
        Action   = ["ecs:RunTask"]
        Resource = "arn:aws:ecs:${local.region}:${local.account_id}:task-definition/${local.publish_family}:*"
      },
      {
        # Because the admin calls RunTask and hands the publish task its two
        # roles, it must PassRole both — without it RunTask fails with an
        # opaque AccessDenied that never mentions PassRole.
        Sid      = "PassBothPublishRoles"
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = [aws_iam_role.publish_exec.arn, aws_iam_role.publish_task.arn]
        Condition = {
          StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" }
        }
      },
      {
        Sid      = "DashboardStackReadDelete"
        Effect   = "Allow"
        Action   = ["cloudformation:DescribeStacks", "cloudformation:DeleteStack"]
        Resource = "arn:aws:cloudformation:${local.region}:${local.account_id}:stack/mmgis-dashboard-*/*"
      },
      {
        Sid      = "EmptyDashboardBuckets"
        Effect   = "Allow"
        Action   = ["s3:DeleteObject"]
        Resource = "arn:aws:s3:::mmgis-dashboard-*/*"
      },
      {
        Sid      = "ListDashboardBuckets"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = "arn:aws:s3:::mmgis-dashboard-*"
      },
      {
        Sid      = "TeardownDashboardBuckets"
        Effect   = "Allow"
        Action   = ["s3:DeleteBucket", "s3:DeleteBucketPolicy"]
        Resource = "arn:aws:s3:::mmgis-dashboard-*"
      },
      {
        Sid    = "TeardownDashboardDistributions"
        Effect = "Allow"
        Action = [
          "cloudfront:GetDistribution",
          "cloudfront:GetDistributionConfig",
          "cloudfront:UpdateDistribution",
          "cloudfront:DeleteDistribution",
        ]
        Resource = "arn:aws:cloudfront::${local.account_id}:distribution/*"
      },
      {
        Sid      = "TeardownDashboardAuthFunctions"
        Effect   = "Allow"
        Action   = ["cloudfront:DescribeFunction", "cloudfront:GetFunction", "cloudfront:DeleteFunction"]
        Resource = "arn:aws:cloudfront::${local.account_id}:function/mmgis-dashboard-*"
      },
      {
        Sid      = "TeardownDashboardOriginAccessControls"
        Effect   = "Allow"
        Action   = ["cloudfront:GetOriginAccessControl", "cloudfront:DeleteOriginAccessControl"]
        Resource = "arn:aws:cloudfront::${local.account_id}:origin-access-control/*"
      },
      {
        Sid      = "UploadAdminAssets"
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.assets.arn}/*"
      },
    ]
  })
}

# ── Publish execution role ──
resource "aws_iam_role" "publish_exec" {
  name                 = "${local.name_prefix}-publish-task-execution"
  description          = "ECS-side role for the ${local.publish_family} task: pull image, write logs, inject publish secrets[]. Lean deployment only."
  assume_role_policy   = local.ecs_tasks_assume_role
  permissions_boundary = var.permissions_boundary
}

resource "aws_iam_role_policy" "publish_exec" {
  name = "${local.name_prefix}-publish-task-execution"
  role = aws_iam_role.publish_exec.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "EcrAuthTokenNoResourceScoping"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid      = "EcrPullImage"
        Effect   = "Allow"
        Action   = ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"]
        Resource = local.ecr_repo_arn
      },
      {
        Sid      = "CloudWatchLogsWrite"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.publish.arn}:*"
      },
      {
        Sid      = "InjectPublishTaskSecrets"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = local.publish_exec_secret_arns
      },
    ]
  })
}

# ── Publish task role (runtime container code) ──
resource "aws_iam_role" "publish_task" {
  name                 = "${local.name_prefix}-publish-task"
  description          = "Runtime role for the ${local.publish_family} container (scripts/publish-static.js): create/describe/delete the mmgis-dashboard-* stacks and their S3/CloudFront resources, read the shared asset bucket. No secretsmanager (password rides the exec role's secrets[]). No rds-db:connect (password auth). Lean deployment only."
  assume_role_policy   = local.ecs_tasks_assume_role
  permissions_boundary = var.permissions_boundary
}

resource "aws_iam_role_policy" "publish_task" {
  name = "${local.name_prefix}-publish-task"
  role = aws_iam_role.publish_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "DashboardStackLifecycle"
        Effect = "Allow"
        Action = [
          "cloudformation:CreateStack",
          "cloudformation:DescribeStacks",
          "cloudformation:DescribeStackEvents",
          "cloudformation:DeleteStack",
        ]
        Resource = "arn:aws:cloudformation:${local.region}:${local.account_id}:stack/mmgis-dashboard-*/*"
      },
      {
        Sid    = "DashboardBucketLifecycle"
        Effect = "Allow"
        Action = [
          "s3:CreateBucket",
          "s3:DeleteBucket",
          "s3:GetBucketLocation",
          "s3:PutBucketPolicy",
          "s3:DeleteBucketPolicy",
          "s3:PutBucketPublicAccessBlock",
          "s3:PutEncryptionConfiguration",
          "s3:PutBucketTagging",
        ]
        Resource = "arn:aws:s3:::mmgis-dashboard-*"
      },
      {
        Sid      = "DashboardBucketWriteObjects"
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "arn:aws:s3:::mmgis-dashboard-*/*"
      },
      {
        Sid    = "DashboardDistributionLifecycle"
        Effect = "Allow"
        Action = [
          "cloudfront:CreateDistribution",
          "cloudfront:GetDistribution",
          "cloudfront:UpdateDistribution",
          "cloudfront:DeleteDistribution",
          "cloudfront:TagResource",
          "cloudfront:UntagResource",
          "cloudfront:ListTagsForResource",
          "cloudfront:CreateInvalidation",
        ]
        Resource = "arn:aws:cloudfront::${local.account_id}:distribution/*"
      },
      {
        Sid    = "DashboardAuthFunctionLifecycle"
        Effect = "Allow"
        Action = [
          "cloudfront:CreateFunction",
          "cloudfront:PublishFunction",
          "cloudfront:DescribeFunction",
          "cloudfront:DeleteFunction",
          "cloudfront:GetFunction",
          "cloudfront:TagResource",
          "cloudfront:UntagResource",
          "cloudfront:ListTagsForResource",
        ]
        Resource = "arn:aws:cloudfront::${local.account_id}:function/mmgis-dashboard-*"
      },
      {
        Sid    = "DashboardOriginAccessControlLifecycle"
        Effect = "Allow"
        Action = [
          "cloudfront:CreateOriginAccessControl",
          "cloudfront:GetOriginAccessControl",
          "cloudfront:DeleteOriginAccessControl",
        ]
        Resource = "arn:aws:cloudfront::${local.account_id}:origin-access-control/*"
      },
      {
        Sid      = "ReadSharedAssetObjects"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.assets.arn}/*"
      },
      {
        Sid      = "ListSharedAssetBucket"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.assets.arn
      },
    ]
  })
}

# ── Express infrastructure role ──
# REQUIRED by aws_ecs_express_gateway_service (infrastructure_role_arn). ECS
# assumes it to provision the service's ALB, security groups, and certificates.
# Trust-only plus the AWS managed policy — NO inline policy. Cannot be modified
# after the service is created.
resource "aws_iam_role" "express_infra" {
  name                 = "${local.name_prefix}-express-infrastructure"
  description          = "Infrastructure role for the ${local.service_name} Express service. Trust-only + AWS managed policy; no inline policy. Immutable after service creation. Lean deployment only."
  permissions_boundary = var.permissions_boundary
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowEcsServiceAssume"
      Effect    = "Allow"
      Principal = { Service = "ecs.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = { StringEquals = { "aws:SourceAccount" = local.account_id } }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "express_infra" {
  role = aws_iam_role.express_infra.name
  # NOTE the lowercase "for" — the camel-cased name does not exist.
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRoleforExpressGatewayServices"
}
