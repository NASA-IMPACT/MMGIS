output "state_bucket_names" {
  description = "env => Terraform state bucket name. Copied into each GitHub Environment's variables and passed to `terraform init -backend-config=bucket=…` by the plan (iac-plan.yml) and apply (iac-deploy.yml) workflows."
  value       = { for env in local.environments : env => aws_s3_bucket.state[env].id }
}

output "bootstrap_state_bucket" {
  description = "This root's own state bucket. Used only by the operator running `terraform init -backend-config=bucket=…` here; no CI role has any access to it."
  value       = aws_s3_bucket.state["bootstrap"].id
}

output "apply_role_arns" {
  description = "env => Terraform apply role ARN. Set as the GitHub Environment variable the apply workflow (iac-deploy.yml) hands to aws-actions/configure-aws-credentials."
  value       = { for env, role in aws_iam_role.terraform_apply : env => role.arn }
}

output "plan_role_arn" {
  description = "Read-only plan role ARN, assumed by the PR plan-preview workflow (iac-plan.yml). Repository-level, not per-environment — the plan job runs unbound."
  value       = aws_iam_role.terraform_plan.arn
}

output "deploy_role_arns" {
  description = "env => image-roll deploy role ARN, assumed by the app deploy engine (app-deploy.yml) from an environment-bound job."
  value       = { for env, role in aws_iam_role.deploy : env => role.arn }
}

output "permissions_boundary_arns" {
  description = "env => the boundary every IAM role created in that environment must carry. Threaded per environment into the environment module's `permissions_boundary` input; each apply role refuses an iam:CreateRole that does not supply its own environment's boundary."
  value       = { for env, policy in aws_iam_policy.ci_role_boundary : env => policy.arn }
}
