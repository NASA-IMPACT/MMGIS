# The permissions boundary attached to EVERY IAM role the CI apply roles create.
# iam_apply.tf makes that a hard condition: an iam:CreateRole that does not
# supply this exact boundary is denied outright.
#
# This is a CAP, not a grant. A capped role's effective permissions are the
# intersection of its own policy with this one, so nothing here hands anybody
# anything — it only bounds how far a mis-written (or malicious) inline policy
# on a CI-created role could ever reach. The content is a superset of what the
# five runtime roles legitimately do (admin/publish task-execution roles,
# admin/publish task roles, and the Express infrastructure role), mined from the
# environment module's iam.tf and the production-tested infrastructure/iam/*.json
# inventory it was translated from.
#
# What is deliberately ABSENT is the point:
#   - no iam writes at all beyond the service-scoped PassRole below,
#   - no sts, so a capped role can never hop to another identity,
#   - no secretsmanager writes — runtime roles read secret values, never set them,
#   - no reach to any *-tfstate-* bucket: the S3 resource patterns below cannot
#     match that name shape (see DashboardAndAssetBuckets).
#
# A boundary does NOT constrain trust-policy edits. That fence is the explicit
# Deny in iam_apply.tf, not here.
resource "aws_iam_policy" "ci_role_boundary" {
  name        = "mmgis-ci-role-boundary"
  description = "Permissions boundary required on every IAM role created by the MMGIS Terraform apply roles. Caps CI-created roles at the runtime surface; grants nothing on its own."
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # ecr:GetAuthorizationToken supports NO resource-level scoping; it
        # authorizes against * by design (mirrors AmazonECSTaskExecutionRolePolicy)
        # and returns only a registry auth token, no repository data access.
        Sid      = "EcrAuthTokenNoResourceScoping"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        # Image pull for the task-execution roles. Repositories are named
        # mmgis-<env>, so the mmgis-* prefix caps every environment's repo — the
        # real ones and the documented development-scratch one — and nothing else.
        Sid      = "EcrPull"
        Effect   = "Allow"
        Action   = ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"]
        Resource = "arn:aws:ecr:${local.region}:${local.account_id}:repository/mmgis-*"
      },
      {
        # Container log delivery into /ecs/mmgis-<env>-admin and
        # /ecs/mmgis-<env>-publish. The trailing wildcard also absorbs the
        # :log-stream:<name> suffix these two actions authorize against.
        Sid      = "LogsWrite"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${local.region}:${local.account_id}:log-group:/ecs/mmgis-*"
      },
      {
        # Secret injection for the execution roles' secrets[]. Two shapes:
        #   - mmgis/* is the PATH-style secret convention (mmgis/<env>/db, …), a
        #     different pattern from the mmgis-<env>-* resource prefix that the
        #     cap must carry explicitly or every injection fails;
        #   - rds!* is the RDS-managed master secret, which RDS itself names
        #     rds!db-<id>. The environment injects DB_PASS straight from it, so
        #     the cap has to include a name nobody here chose.
        Sid    = "ReadRuntimeSecrets"
        Effect = "Allow"
        Action = ["secretsmanager:GetSecretValue"]
        Resource = [
          "arn:aws:secretsmanager:${local.region}:${local.account_id}:secret:mmgis/*",
          "arn:aws:secretsmanager:${local.region}:${local.account_id}:secret:rds!*",
        ]
      },
      {
        # The admin task launches the publish task by family name.
        Sid      = "RunPublishTask"
        Effect   = "Allow"
        Action   = ["ecs:RunTask"]
        Resource = "arn:aws:ecs:${local.region}:${local.account_id}:task-definition/mmgis-*"
      },
      {
        # The ONLY iam action in the boundary, and it is scoped twice over: by
        # role name and by the service the role may be handed to. Without it the
        # admin task's RunTask fails with an opaque AccessDenied that never
        # mentions PassRole.
        Sid      = "PassRuntimeRolesToEcs"
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = "arn:aws:iam::${local.account_id}:role/mmgis-*"
        Condition = {
          StringEquals = {
            "iam:PassedToService" = ["ecs-tasks.amazonaws.com", "ecs.amazonaws.com"]
          }
        }
      },
      {
        # Dashboards are published by the application at RUNTIME, not by
        # Terraform: the publish task stands up one CloudFormation stack per
        # dashboard and the admin task tears them down.
        Sid    = "DashboardStacks"
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
        # The dashboard buckets the publish task creates, plus the environment's
        # shared asset bucket.
        #
        # Neither pattern can match a Terraform state bucket: the state name
        # shape is mmgis-<env>-tfstate-<account_id>, and "-tfstate-" contains
        # neither "dashboard" nor "-assets-". Even a mis-granted runtime role is
        # therefore structurally fenced off state. (mmgis-*-assets-* does in
        # principle match other odd names; a cap only ever meets a grant the
        # apply role can create, and those are prefix-scoped.)
        Sid    = "DashboardAndAssetBuckets"
        Effect = "Allow"
        Action = [
          "s3:CreateBucket",
          "s3:DeleteBucket",
          "s3:GetBucketLocation",
          "s3:ListBucket",
          "s3:PutBucketPolicy",
          "s3:DeleteBucketPolicy",
          "s3:PutBucketPublicAccessBlock",
          "s3:PutEncryptionConfiguration",
          "s3:PutBucketTagging",
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject",
        ]
        Resource = [
          "arn:aws:s3:::mmgis-dashboard-*",
          "arn:aws:s3:::mmgis-dashboard-*/*",
          "arn:aws:s3:::mmgis-*-assets-*",
          "arn:aws:s3:::mmgis-*-assets-*/*",
        ]
      },
      {
        # Dashboard front doors. Distribution and origin-access-control ids are
        # generated by CloudFront, so only the function name can be
        # prefix-scoped — the per-service honesty table in README.md records
        # which patterns AWS actually supports.
        Sid    = "DashboardCloudFront"
        Effect = "Allow"
        Action = [
          "cloudfront:CreateDistribution",
          "cloudfront:GetDistribution",
          "cloudfront:GetDistributionConfig",
          "cloudfront:UpdateDistribution",
          "cloudfront:DeleteDistribution",
          "cloudfront:TagResource",
          "cloudfront:UntagResource",
          "cloudfront:ListTagsForResource",
          "cloudfront:CreateInvalidation",
          "cloudfront:CreateFunction",
          "cloudfront:PublishFunction",
          "cloudfront:DescribeFunction",
          "cloudfront:GetFunction",
          "cloudfront:DeleteFunction",
          "cloudfront:CreateOriginAccessControl",
          "cloudfront:GetOriginAccessControl",
          "cloudfront:DeleteOriginAccessControl",
        ]
        Resource = [
          "arn:aws:cloudfront::${local.account_id}:distribution/*",
          "arn:aws:cloudfront::${local.account_id}:function/mmgis-dashboard-*",
          "arn:aws:cloudfront::${local.account_id}:origin-access-control/*",
        ]
      },
      {
        # The Express infrastructure role carries the AWS managed policy
        # AmazonECSInfrastructureRoleforExpressGatewayServices, which ECS uses to
        # provision the service's ALB, security groups and certificates. A
        # boundary that under-caps it breaks service provisioning in
        # hard-to-debug ways — and AWS may extend that policy at any time — so
        # the cap mirrors its SERVICE SURFACE rather than enumerating actions.
        # The effective permissions remain exactly the managed policy, because a
        # boundary is an intersection and never a grant. Verified end-to-end by
        # the scratch apply in README.md.
        Sid    = "ExpressInfrastructureSurface"
        Effect = "Allow"
        Action = [
          "elasticloadbalancing:*",
          "ec2:*",
          "acm:*",
          "application-autoscaling:*",
        ]
        Resource = "*"
      },
    ]
  })
}
