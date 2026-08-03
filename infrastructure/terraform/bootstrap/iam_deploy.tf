# Per-environment image-roll deploy role, relocated verbatim from the
# environment module (#199 deletes the in-module twin; the role NAME,
# mmgis-<env>-github-deploy, is the contract between the halves). Two changes
# in the move: trust is re-scoped from the old branch-ref subject to the
# GitHub Environment subject (#247 binds `environment:` at job level), and
# ARNs are constructed from the naming convention because bootstrap applies
# before the environment exists. No operator-assume statement: nothing
# requires a human to hold this role.

locals {
  deploy_service_arns = { for env in local.environments : env => "arn:aws:ecs:${local.region}:${local.account_id}:service/mmgis-${env}/mmgis-${env}-admin" }

  # PassRole is pinned to exactly these five runtime roles — not to a prefix.
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
      # Environment-bound jobs present repo:<owner/name>:environment:<env>;
      # the GitHub Environment names must keep matching these strings exactly.
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
        # Exact repository name, no wildcard: CI only ever pushes to the real
        # environment repo.
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
        # Register/DescribeTaskDefinition support no resource-level scoping.
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
        # Update + Describe only — creating a service is Terraform's job, and
        # a compromised deploy token must not stand up new services. The API
        # authorizes these against the SERVICE ARN (learned empirically), not
        # the express-gateway-service/* shape, so both are listed.
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
        # Registering task-def revisions passes the task/exec roles; an
        # Express service update passes the infra role too.
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
