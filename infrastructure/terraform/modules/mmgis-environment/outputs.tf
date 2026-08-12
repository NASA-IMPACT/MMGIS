# ── Workflow variable values (repo/Environment Actions variables) ──

output "workflow_variables" {
  description = "Every value the deploy workflows need, read in one `terraform output -json workflow_variables` call. Keys are the GitHub Actions variable names. Deliberately NO deploy-role ARN: the CI role is created by the bootstrap root (environment-scoped trust), never by this module."
  value = {
    AWS_REGION          = local.region
    ECR_REPOSITORY      = aws_ecr_repository.this.name
    ECS_CLUSTER         = aws_ecs_cluster.this.name
    ECS_SERVICE         = aws_ecs_express_gateway_service.admin.service_name
    ADMIN_TASK_FAMILY   = local.admin_family
    PUBLISH_TASK_FAMILY = local.publish_family
  }
}

# ── Phase-1 -> phase-2 handoff (feed these back as tfvars for the CF apply) ──

output "express_service_arn" {
  description = "The Express gateway service ARN."
  value       = aws_ecs_express_gateway_service.admin.service_arn
}

output "express_ingress_paths" {
  description = "The service's ingress paths. Read the on.aws endpoint here (it is also readable off the newest service revision via `aws ecs describe-service-revisions`) and pass it back as express_onaws_endpoint for the phase-2 CloudFront apply."
  value       = aws_ecs_express_gateway_service.admin.ingress_paths
}

# ── Data / operational references ──

output "rds_managed_master_secret_arn" {
  description = "ARN of the RDS-managed master-user secret ({username,password}) — the ONLY place the DB password lives. Both task defs reference its `password` key directly; nothing is copied out of it. Informational."
  value       = try(aws_db_instance.this.master_user_secret[0].secret_arn, null)
}

# ── Phase-2 CloudFront outputs (null until the CF apply) ──

output "admin_distribution_id" {
  description = "Admin CloudFront distribution id (phase 2)."
  value       = local.enable_cloudfront ? aws_cloudfront_distribution.admin[0].id : null
}

output "admin_url" {
  description = "The admin CloudFront URL (phase 2) — the authoritative place to read it (deliberately surfaced nowhere in CI)."
  value       = local.enable_cloudfront ? "https://${aws_cloudfront_distribution.admin[0].domain_name}" : null
}
