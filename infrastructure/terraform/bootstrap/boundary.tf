# The permissions boundary attached to EVERY IAM role the CI apply roles create,
# one per environment. iam_apply.tf makes that a hard condition: an
# iam:CreateRole that does not supply this exact boundary is denied outright.
#
# WHY PER ENVIRONMENT. A single boundary shared across environments would cap
# every CI-created role at the union of both environments' needs, so the
# development apply role could mint a boundary-capped role whose own inline
# policy reads mmgis/production/* secrets, passes production runtime roles, runs
# production task definitions and pulls production images — and the cap would
# permit all of it. Splitting the boundary per environment makes the development
# blast radius development-only: a role created by the dev apply role cannot
# reach a production resource no matter what its inline policy says.
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
  for_each = local.environments

  name        = "mmgis-ci-role-boundary-${each.key}"
  description = "Permissions boundary required on every IAM role created by the MMGIS ${each.key} Terraform apply role. Caps CI-created roles at the ${each.key} runtime surface; grants nothing on its own."
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
        # Image pull for the task-execution roles. The repository is named
        # mmgis-<env>, and the trailing * with no separator also covers the
        # documented development-scratch repo — this environment's images and
        # nothing else's.
        Sid      = "EcrPull"
        Effect   = "Allow"
        Action   = ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"]
        Resource = "arn:aws:ecr:${local.region}:${local.account_id}:repository/mmgis-${each.key}*"
      },
      {
        # Container log delivery into /ecs/mmgis-<env>-admin and
        # /ecs/mmgis-<env>-publish. The trailing wildcard also absorbs the
        # :log-stream:<name> suffix these two actions authorize against.
        Sid      = "LogsWrite"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${local.region}:${local.account_id}:log-group:/ecs/mmgis-${each.key}*"
      },
      {
        # Secret injection for the execution roles' secrets[]. Secrets are
        # PATH-style — mmgis/<env>/db, mmgis/<env>/session-secret, … — a
        # different convention from the mmgis-<env>-* resource prefix that the
        # cap must carry explicitly or every injection fails. No separator
        # before the trailing * so the documented scratch environment
        # (mmgis/development-scratch/…) is covered by the development boundary,
        # and so the random -XXXXXX suffix Secrets Manager appends to every
        # secret ARN is absorbed.
        Sid      = "ReadRuntimeSecrets"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = "arn:aws:secretsmanager:${local.region}:${local.account_id}:secret:mmgis/${each.key}*"
      },
      {
        # The RDS-managed master secret, which RDS itself names rds!db-<id>.
        # The environment injects DB_PASS straight from it, so the cap has to
        # include a name nobody here chose — and that name carries nothing to
        # scope on, which would put both environments' master passwords inside
        # every environment's boundary. RDS tags the managed secret with
        # aws:rds:primaryDBInstanceArn, the only env-distinguishing handle
        # available, so the condition scopes on the tag instead of the name.
        # Verified at apply time by the scratch run (README.md §7d); if the tag
        # turns out to be absent, the fallback is the bare rds!* pattern plus a
        # documented residual — decided then, not silently.
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
        # The admin task launches the publish task by family name.
        Sid      = "RunPublishTask"
        Effect   = "Allow"
        Action   = ["ecs:RunTask"]
        Resource = "arn:aws:ecs:${local.region}:${local.account_id}:task-definition/mmgis-${each.key}*"
      },
      {
        # The ONLY iam action in the boundary, and it is scoped three times
        # over: by environment, by role name and by the service the role may be
        # handed to. Without it the admin task's RunTask fails with an opaque
        # AccessDenied that never mentions PassRole.
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
        # Dashboards are published by the application at RUNTIME, not by
        # Terraform: the publish task stands up one CloudFormation stack per
        # dashboard and the admin task tears them down.
        #
        # Published dashboards are not yet namespaced per environment, so this
        # pattern stays unscoped. Issue #250 renames them mmgis-<env>-dashboard-*;
        # this pattern tightens to the environment's own prefix when it lands.
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
        # The dashboard buckets the publish task creates, plus this
        # environment's shared asset bucket. Two asset patterns because the
        # scratch environment's bucket (mmgis-development-scratch-assets-<acct>)
        # cannot share a single pattern with the real one.
        #
        # The mmgis-dashboard-* patterns stay UNSCOPED for the same reason as
        # DashboardStacks above: published dashboards are not yet namespaced per
        # environment. Issue #250 renames them mmgis-<env>-dashboard-*, and these
        # patterns tighten to the environment's own prefix when it lands.
        #
        # No pattern here can match a Terraform state bucket: the state name
        # shape is mmgis-<env>-tfstate-<account_id>, and "-tfstate-" contains
        # neither "dashboard" nor "-assets-". Even a mis-granted runtime role is
        # therefore structurally fenced off state.
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
          "arn:aws:s3:::mmgis-${each.key}-assets-*",
          "arn:aws:s3:::mmgis-${each.key}-assets-*/*",
          "arn:aws:s3:::mmgis-${each.key}-*-assets-*",
          "arn:aws:s3:::mmgis-${each.key}-*-assets-*/*",
        ]
      },
      {
        # Dashboard front doors. Distribution and origin-access-control ids are
        # generated by CloudFront, so only the function name can be
        # prefix-scoped — the per-service honesty table in README.md records
        # which patterns AWS actually supports.
        #
        # The function name pattern stays unscoped by environment because
        # published dashboards are not yet namespaced per environment; #250
        # renames them mmgis-<env>-dashboard-*, and this tightens when it lands.
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
      {
        # The service wildcards above exist so an AWS-side extension of the
        # managed policy cannot brick service provisioning — but nothing Express
        # Mode does involves instances, volumes, images, or VPC topology.
        # Denying those families here caps the worst case of a mis-written
        # capped role at SG/ALB/certificate surface, not account-wide EC2.
        # Describe* stays allowed above: provisioning reads VPC and subnet facts.
        Sid    = "DenyEc2BlastRadius"
        Effect = "Deny"
        Action = [
          "ec2:RunInstances",
          "ec2:StartInstances",
          "ec2:StopInstances",
          "ec2:TerminateInstances",
          "ec2:CreateVolume",
          "ec2:CreateSnapshot",
          "ec2:CreateSnapshots",
          "ec2:CopySnapshot",
          "ec2:CreateImage",
          "ec2:CopyImage",
          "ec2:RegisterImage",
          "ec2:CreateVpc",
          "ec2:DeleteVpc",
          "ec2:ModifyVpcAttribute",
          "ec2:CreateSubnet",
          "ec2:DeleteSubnet",
          "ec2:CreateRouteTable",
          "ec2:DeleteRouteTable",
          "ec2:CreateRoute",
          "ec2:DeleteRoute",
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
