# Per-environment GitHub OIDC deploy role assumed by deploy-lean.yml. Trust is
# BRANCH-scoped for now (repo:<owner/name>:ref:refs/heads/<branch>): the
# workflow declares no GitHub Environment until #195, so a job without
# `environment:` presents a branch-ref subject. #195 tightens this to
# repo:...:environment:<env> when it wires `environment:` into the job.
resource "aws_iam_role" "deploy" {
  name        = "${local.name_prefix}-github-deploy"
  description = "GitHub OIDC deploy role for the ${var.environment} environment (deploy-lean.yml). Branch-scoped trust."
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "GitHubOidcBranchScoped"
      Effect    = "Allow"
      Principal = { Federated = data.aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repo}:ref:refs/heads/${local.deploy_branch}"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "deploy" {
  name = "${local.name_prefix}-github-deploy"
  role = aws_iam_role.deploy.id
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
        # ECR push scoped to THIS environment's repository only.
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
        Resource = local.ecr_repo_arn
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
        Resource = local.service_arn
      },
      {
        # The three ExpressGatewayService actions. The API authorizes
        # Update/Describe against the SERVICE ARN (learned empirically), NOT
        # the express-gateway-service/* shape, so the Resource lists BOTH.
        Sid    = "ExpressGatewayServiceDeploy"
        Effect = "Allow"
        Action = [
          "ecs:CreateExpressGatewayService",
          "ecs:UpdateExpressGatewayService",
          "ecs:DescribeExpressGatewayService",
        ]
        Resource = [
          "arn:aws:ecs:${local.region}:${local.account_id}:express-gateway-service/*",
          local.service_arn,
        ]
      },
      {
        # Pinned PassRole: registering task-def revisions passes the task/exec
        # roles; an Express service create/update passes the infra role too.
        Sid    = "PassEnvTaskRoles"
        Effect = "Allow"
        Action = ["iam:PassRole"]
        Resource = [
          aws_iam_role.admin_exec.arn,
          aws_iam_role.admin_task.arn,
          aws_iam_role.publish_exec.arn,
          aws_iam_role.publish_task.arn,
          aws_iam_role.express_infra.arn,
        ]
      },
    ]
  })
}
