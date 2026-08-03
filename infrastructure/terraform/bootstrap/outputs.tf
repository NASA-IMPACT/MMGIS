output "state_bucket_names" {
  description = "env => Terraform state bucket name. Copied into each GitHub Environment's variables by #252 and passed to `terraform init -backend-config=bucket=…` by the plan (#246) and apply (#247) workflows."
  value       = { for env in local.environments : env => aws_s3_bucket.state[env].id }
}

output "bootstrap_state_bucket" {
  description = "This root's own state bucket. Used only by the operator running `terraform init -backend-config=bucket=…` here; no CI role has any access to it."
  value       = aws_s3_bucket.state["bootstrap"].id
}

output "apply_role_arns" {
  description = "env => Terraform apply role ARN. Set as the GitHub Environment variable the apply workflow (#247) hands to aws-actions/configure-aws-credentials."
  value       = { for env, role in aws_iam_role.terraform_apply : env => role.arn }
}

output "plan_role_arn" {
  description = "Read-only plan role ARN, assumed by the PR plan-preview workflow (#246). Repository-level, not per-environment — the plan job runs unbound."
  value       = aws_iam_role.terraform_plan.arn
}

output "deploy_role_arns" {
  description = "env => image-roll deploy role ARN, assumed by the app deploy engine (#247) from an environment-bound job."
  value       = { for env, role in aws_iam_role.deploy : env => role.arn }
}

output "permissions_boundary_arn" {
  description = "The boundary every CI-created IAM role must carry. Threaded into the environment module's `permissions_boundary` input by #199; the apply roles refuse an iam:CreateRole without it."
  value       = aws_iam_policy.ci_role_boundary.arn
}
