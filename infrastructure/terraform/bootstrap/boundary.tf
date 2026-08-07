# Per-environment permissions boundary required on every role the CI apply
# roles create (iam_apply.tf denies iam:CreateRole without exactly this
# boundary). A boundary is a cap, not a grant: effective permissions are the
# intersection with the role's own policy. Per environment so a dev-created
# role can never reach production resources. Boundaries do NOT constrain
# trust-policy edits — that fence is the explicit Deny in iam_apply.tf.
# Containment model: docs/infrastructure/README.md.
resource "aws_iam_policy" "ci_role_boundary" {
  for_each = local.environments

  name        = "mmgis-ci-role-boundary-${each.key}"
  description = "Permissions boundary required on every IAM role created by the MMGIS ${each.key} Terraform apply role. Caps CI-created roles at the ${each.key} runtime surface; grants nothing on its own."
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # ecr:GetAuthorizationToken supports no resource-level scoping; it
        # returns only a registry auth token, no repository data access.
        Sid      = "EcrAuthTokenNoResourceScoping"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        # No separator before the * so the development-scratch repo also matches.
        Sid      = "EcrPull"
        Effect   = "Allow"
        Action   = ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"]
        Resource = "arn:aws:ecr:${local.region}:${local.account_id}:repository/mmgis-${each.key}*"
      },
      {
        # Trailing * also absorbs the :log-stream:<name> suffix these two
        # actions authorize against.
        Sid      = "LogsWrite"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${local.region}:${local.account_id}:log-group:/ecs/mmgis-${each.key}*"
      },
      {
        # Secrets are PATH-style (mmgis/<env>/db, …) — a different convention
        # from the mmgis-<env>-* resource prefix. No separator before the * so
        # mmgis/development-scratch/… matches and the random -XXXXXX suffix
        # Secrets Manager appends to every secret ARN is absorbed.
        Sid      = "ReadRuntimeSecrets"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = "arn:aws:secretsmanager:${local.region}:${local.account_id}:secret:mmgis/${each.key}*"
      },
      {
        # RDS names its managed master secret rds!db-<id> — nothing
        # env-distinguishing — so the condition scopes on the
        # aws:rds:primaryDBInstanceArn tag RDS sets, the only per-environment
        # handle. Verified at apply time by the scratch run (README.md).
        Sid      = "ReadRdsManagedMasterSecret"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = "arn:aws:secretsmanager:${local.region}:${local.account_id}:secret:rds!*"
        Condition = {
          ArnLike = {
            "secretsmanager:ResourceTag/aws:rds:primaryDBInstanceArn" = "arn:aws:rds:${local.region}:${local.account_id}:db:mmgis-${each.key}*"
          }
        }
      },
      {
        # GetSecretValue on the managed master secret makes Secrets Manager
        # decrypt with the caller's credentials, so the cap has to cover the
        # key (kms.tf) or the execution roles' secrets[] injection fails at task
        # start. One key serves both environments; the secret scoping above is
        # what keeps them apart. The ViaService condition means a capped role can
        # only ever use the key through Secrets Manager, never directly.
        Sid      = "DecryptRdsMasterSecret"
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = aws_kms_key.master_secret.arn
        Condition = {
          StringEquals = {
            "kms:ViaService" = "secretsmanager.${local.region}.amazonaws.com"
          }
        }
      },
      {
        # The admin task launches the publish task by family name.
        Sid      = "RunPublishTask"
        Effect   = "Allow"
        Action   = ["ecs:RunTask"]
        Resource = "arn:aws:ecs:${local.region}:${local.account_id}:task-definition/mmgis-${each.key}*"
      },
      {
        # Without it the admin task's RunTask fails with an AccessDenied that
        # never mentions PassRole.
        Sid      = "PassRuntimeRolesToEcs"
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = "arn:aws:iam::${local.account_id}:role/mmgis-${each.key}-*"
        Condition = {
          StringEquals = {
            "iam:PassedToService" = ["ecs-tasks.amazonaws.com", "ecs.amazonaws.com"]
          }
        }
      },
      {
        # Dashboards are published by the application at runtime (one
        # CloudFormation stack each), not by Terraform. Stack names carry the
        # per-environment mmgis-<env>-dashboard- prefix, so a dev-created role
        # can never touch another environment's dashboards.
        Sid    = "DashboardStacks"
        Effect = "Allow"
        Action = [
          "cloudformation:CreateStack",
          "cloudformation:DescribeStacks",
          "cloudformation:DescribeStackEvents",
          "cloudformation:DeleteStack",
        ]
        Resource = "arn:aws:cloudformation:${local.region}:${local.account_id}:stack/mmgis-${each.key}-dashboard-*/*"
      },
      {
        # Two asset patterns because the scratch bucket
        # (mmgis-development-scratch-assets-*) cannot share one pattern with the
        # real one. Dashboard buckets carry the same per-environment
        # mmgis-<env>-dashboard- prefix as the stacks. No pattern here can
        # match a *-tfstate-* bucket name, so even a mis-granted runtime role
        # is structurally fenced off state.
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
          "arn:aws:s3:::mmgis-${each.key}-dashboard-*",
          "arn:aws:s3:::mmgis-${each.key}-dashboard-*/*",
          "arn:aws:s3:::mmgis-${each.key}-assets-*",
          "arn:aws:s3:::mmgis-${each.key}-assets-*/*",
          "arn:aws:s3:::mmgis-${each.key}-*-assets-*",
          "arn:aws:s3:::mmgis-${each.key}-*-assets-*/*",
        ]
      },
      {
        # Distribution and origin-access-control ids are CloudFront-generated,
        # so only the function name can be prefix-scoped (honesty table:
        # docs/infrastructure/identity.md). Function names carry the
        # per-environment mmgis-<env>-dashboard- prefix.
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
          "arn:aws:cloudfront::${local.account_id}:function/mmgis-${each.key}-dashboard-*",
          "arn:aws:cloudfront::${local.account_id}:origin-access-control/*",
        ]
      },
      {
        # The Express infrastructure role carries the AWS managed policy
        # AmazonECSInfrastructureRoleforExpressGatewayServices, which AWS may
        # extend at any time; the cap mirrors its service surface rather than
        # enumerating actions so an AWS-side extension cannot break service
        # provisioning. Effective permissions remain exactly the managed policy
        # (a boundary is an intersection, never a grant).
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
      {
        # The Express infrastructure role also publishes the gateway's
        # autoscaling alarms and creates its log group. ECS names both, as it
        # does the security groups above, so the cap can pin only
        # the account and region and enumerate actions (honesty table:
        # docs/infrastructure/identity.md); the AmazonECSManaged tag conditions
        # that hold the role to ECS-created alarms and log groups live in the
        # managed policy. Enumerated rather than wildcarded like the statement
        # above because logs:* would widen the cap to reading every log group in
        # the account, undoing LogsWrite's scoping — the tradeoff is that an
        # AWS-side extension in these two services needs a boundary edit.
        Sid    = "ExpressInfrastructureAlarmsAndLogGroup"
        Effect = "Allow"
        Action = [
          "cloudwatch:PutMetricAlarm",
          "cloudwatch:DescribeAlarms",
          "cloudwatch:DeleteAlarms",
          "cloudwatch:TagResource",
          "logs:CreateLogGroup",
          "logs:TagResource",
        ]
        Resource = [
          "arn:aws:cloudwatch:${local.region}:${local.account_id}:alarm:*",
          "arn:aws:logs:${local.region}:${local.account_id}:log-group:*",
        ]
      },
      {
        # How the role finds the log group it just created. The managed policy
        # carries this list call on "*" as well, so the cap matches it rather
        # than gamble on which resource form a list call authorizes against.
        # The reply is names and metadata, never log content.
        Sid      = "ExpressInfrastructureLogGroupDiscovery"
        Effect   = "Allow"
        Action   = ["logs:DescribeLogGroups"]
        Resource = "*"
      },
      {
        # The Express service creates the load-balancing and ECS
        # application-autoscaling service-linked roles on first use. The
        # condition mirrors the managed policy's own
        # ServiceLinkedRoleCreateOperations statement, so the cap can never
        # authorize a service-linked role for any other AWS service.
        Sid      = "CreateEcsGatewayServiceLinkedRoles"
        Effect   = "Allow"
        Action   = ["iam:CreateServiceLinkedRole"]
        Resource = "*"
        Condition = {
          StringEquals = {
            "iam:AWSServiceName" = [
              "ecs.application-autoscaling.amazonaws.com",
              "elasticloadbalancing.amazonaws.com",
            ]
          }
        }
      },
      {
        # Express Mode never touches instances, volumes, images, or VPC
        # topology; denying those families caps a mis-written capped role at
        # SG/ALB/certificate surface, not account-wide EC2. Describe* stays
        # allowed above: provisioning reads VPC and subnet facts.
        Sid    = "DenyEc2BlastRadius"
        Effect = "Deny"
        Action = [
          "ec2:RunInstances",
          "ec2:StartInstances",
          "ec2:StopInstances",
          "ec2:TerminateInstances",
          "ec2:CreateFleet",
          "ec2:RequestSpotInstances",
          "ec2:RequestSpotFleet",
          "ec2:CreateVolume",
          "ec2:DeleteVolume",
          "ec2:CreateSnapshot",
          "ec2:CreateSnapshots",
          "ec2:CopySnapshot",
          "ec2:DeleteSnapshot",
          "ec2:CreateImage",
          "ec2:CopyImage",
          "ec2:RegisterImage",
          "ec2:DeregisterImage",
          "ec2:CreateVpc",
          "ec2:DeleteVpc",
          "ec2:ModifyVpcAttribute",
          "ec2:CreateSubnet",
          "ec2:DeleteSubnet",
          "ec2:ModifySubnetAttribute",
          "ec2:CreateRouteTable",
          "ec2:DeleteRouteTable",
          "ec2:AssociateRouteTable",
          "ec2:DisassociateRouteTable",
          "ec2:CreateRoute",
          "ec2:DeleteRoute",
          "ec2:ReplaceRoute",
          "ec2:CreateInternetGateway",
          "ec2:DeleteInternetGateway",
          "ec2:AttachInternetGateway",
          "ec2:DetachInternetGateway",
          "ec2:CreateNatGateway",
          "ec2:DeleteNatGateway",
          "ec2:CreateVpcPeeringConnection",
          "ec2:AcceptVpcPeeringConnection",
          "ec2:CreateKeyPair",
          "ec2:ImportKeyPair",
        ]
        Resource = "*"
      },
    ]
  })
}
