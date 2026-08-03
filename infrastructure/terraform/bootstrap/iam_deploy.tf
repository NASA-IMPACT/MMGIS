# The per-environment image-roll deploy role, relocated here from the
# environment module's iam_deploy.tf. Its POWERS are unchanged — the five
# statements below are the module's, verbatim, with their empirically-learned
# comments intact. The amendments branch (#199) deletes the in-module twin, so
# no duplicate identity survives; the role NAME (mmgis-<env>-github-deploy) is
# the contract between the two halves.
#
# Two things did change in the move:
#   - trust is re-scoped from the old branch-ref subject to the GitHub
#     Environment subject, because the app deploy engine (#247) binds
#     `environment:` at job level;
#   - resource ARNs are CONSTRUCTED from the mmgis-<env>-* naming convention
#     instead of resolved through module attributes. Bootstrap applies before
#     the environment exists, and IAM accepts ARNs for resources that do not
#     exist yet.
#
# Unlike the apply roles, there is no operator-assume statement: nothing
# requires a human to hold this role, so the surface stays minimal.

locals {
  deploy_service_arns = { for env in local.environments : env => "arn:aws:ecs:${local.region}:${local.account_id}:service/mmgis-${env}/mmgis-${env}-admin" }

  # The five runtime roles the module creates, per environment, by constructed
  # name. PassRole is pinned to exactly these — not to a prefix.
  deploy_passable_role_arns = { for env in local.environments : env => [
    "arn:aws:iam::${local.account_id}:role/mmgis-${env}-admin-task-execution",
    "arn:aws:iam::${local.account_id}:role/mmgis-${env}-admin-task",
    "arn:aws:iam::${local.account_id}:role/mmgis-${env}-publish-task-execution",
    "arn:aws:iam::${local.account_id}:role/mmgis-${env}-publish-task",
    "arn:aws:iam::${local.account_id}:role/mmgis-${env}-express-infrastructure",
  ] }
}

resource "aws_iam_role" "deploy" {
  for_each = local.environments

  name        = "mmgis-${each.key}-github-deploy"
  description = "GitHub OIDC deploy role for the ${each.key} environment (image roll only). Environment-scoped trust."
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      # Environment-form subject: the deploy job binds `environment: <env>` at
      # job level, so its OIDC token presents
      # repo:<owner/name>:environment:<env>. The GitHub Environment names must
      # keep matching these strings exactly.
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
    }]
  })
}

resource "aws_iam_role_policy" "deploy" {
  for_each = local.environments

  name = "mmgis-${each.key}-github-deploy"
  role = aws_iam_role.deploy[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "EcrAuthToken"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        # ECR push scoped to THIS environment's repository only — the exact
        # name, no wildcard: CI only ever pushes to the real environment repo.
        Sid    = "EcrPushToEnvRepo"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
        ]
        Resource = "arn:aws:ecr:${local.region}:${local.account_id}:repository/mmgis-${each.key}"
      },
      {
        # RegisterTaskDefinition / DescribeTaskDefinition support no
        # resource-level scoping, so they authorize against *.
        Sid      = "RegisterAndDescribeTaskDefinitions"
        Effect   = "Allow"
        Action   = ["ecs:RegisterTaskDefinition", "ecs:DescribeTaskDefinition"]
        Resource = "*"
      },
      {
        # The workflow resolves the service name -> ARN before rolling it.
        Sid      = "DescribeAdminService"
        Effect   = "Allow"
        Action   = ["ecs:DescribeServices"]
        Resource = local.deploy_service_arns[each.key]
      },
      {
        # Update + Describe only — CI rolls the EXISTING service; creating a
        # service is Terraform's job under the apply role, and a compromised
        # deploy token must not be able to stand up new services. The API
        # authorizes Update/Describe against the SERVICE ARN (learned
        # empirically), NOT the express-gateway-service/* shape, so the Resource
        # lists BOTH.
        Sid    = "ExpressGatewayServiceDeploy"
        Effect = "Allow"
        Action = [
          "ecs:UpdateExpressGatewayService",
          "ecs:DescribeExpressGatewayService",
        ]
        Resource = [
          "arn:aws:ecs:${local.region}:${local.account_id}:express-gateway-service/*",
          local.deploy_service_arns[each.key],
        ]
      },
      {
        # Pinned PassRole: registering task-def revisions passes the task/exec
        # roles; an Express service update passes the infra role too. The
        # PassedToService condition mirrors the runtime roles' pattern.
        Sid      = "PassEnvTaskRoles"
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = local.deploy_passable_role_arns[each.key]
        Condition = {
          StringEquals = {
            "iam:PassedToService" = ["ecs-tasks.amazonaws.com", "ecs.amazonaws.com"]
          }
        }
      },
    ]
  })
}
