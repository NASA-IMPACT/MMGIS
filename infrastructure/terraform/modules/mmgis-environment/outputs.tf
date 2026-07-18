# ── Workflow variable values (repo/Environment Actions variables) ──

output "aws_region" {
  description = "vars.AWS_REGION"
  value       = local.region
}

output "ecr_repository_name" {
  description = "vars.ECR_REPOSITORY"
  value       = aws_ecr_repository.this.name
}

output "ecr_repository_url" {
  description = "Full ECR repository URL (registry/name)."
  value       = aws_ecr_repository.this.repository_url
}

output "ecs_cluster_name" {
  description = "vars.ECS_CLUSTER"
  value       = aws_ecs_cluster.this.name
}

output "ecs_service_name" {
  description = "vars.ECS_SERVICE"
  value       = aws_ecs_express_gateway_service.admin.service_name
}

output "admin_task_family" {
  description = "vars.ADMIN_TASK_FAMILY"
  value       = local.admin_family
}

output "publish_task_family" {
  description = "vars.PUBLISH_TASK_FAMILY"
  value       = local.publish_family
}

output "deploy_role_arn" {
  description = "secrets.AWS_DEPLOY_ROLE_ARN — the GitHub OIDC deploy role for this environment."
  value       = aws_iam_role.deploy.arn
}

# ── Phase-1 -> phase-2 handoff (feed these back as tfvars for the CF apply) ──

output "express_service_arn" {
  description = "The Express gateway service ARN."
  value       = aws_ecs_express_gateway_service.admin.service_arn
}

output "express_ingress_paths" {
  description = "The service's ingress paths. Read the on.aws endpoint here (or via `aws ecs describe-express-gateway-service`) and pass it back as express_onaws_endpoint for the phase-2 CloudFront apply."
  value       = aws_ecs_express_gateway_service.admin.ingress_paths
}

# ── Data / operational references ──

output "rds_endpoint" {
  description = "RDS endpoint (host:port). Copy the host into the app DB secret's DB_HOST out-of-band."
  value       = aws_db_instance.this.address
}

output "rds_managed_master_secret_arn" {
  description = "ARN of the RDS-managed master-user secret ({username,password}). Copy its password into the app DB secret's DB_PASS out-of-band."
  value       = try(aws_db_instance.this.master_user_secret[0].secret_arn, null)
}

output "app_db_secret_arn" {
  description = "ARN of the app-shaped DB secret shell (set DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASS out-of-band)."
  value       = aws_secretsmanager_secret.db.arn
}

output "asset_bucket_name" {
  description = "Shared admin asset bucket name."
  value       = aws_s3_bucket.assets.bucket
}

output "service_security_group_id" {
  description = "The shared admin/publish task security group id (value of MMGIS_PUBLISH_SECURITY_GROUPS)."
  value       = aws_security_group.service.id
}

# ── Phase-2 CloudFront outputs (null until the CF apply) ──

output "admin_distribution_id" {
  description = "Admin CloudFront distribution id (phase 2)."
  value       = local.enable_cloudfront ? aws_cloudfront_distribution.admin[0].id : null
}

output "admin_url" {
  description = "vars.ADMIN_URL — the admin CloudFront domain (phase 2)."
  value       = local.enable_cloudfront ? "https://${aws_cloudfront_distribution.admin[0].domain_name}" : null
}
