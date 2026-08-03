output "workflow_variables" {
  description = "Every value the deploy workflows need, in one object. Keys are the GitHub Actions variable names. The AWS_DEPLOY_ROLE_ARN secret comes from the bootstrap root, not from here."
  value       = module.mmgis.workflow_variables
}

output "express_ingress_paths" {
  description = "Read the on.aws endpoint here for the phase-2 CloudFront apply."
  value       = module.mmgis.express_ingress_paths
}

output "express_service_arn" {
  value = module.mmgis.express_service_arn
}

output "rds_managed_master_secret_arn" {
  description = "The ONLY place the DB password lives; the task defs reference it directly. Informational."
  value       = module.mmgis.rds_managed_master_secret_arn
}

output "admin_distribution_id" {
  value = module.mmgis.admin_distribution_id
}

output "admin_url" {
  value = module.mmgis.admin_url
}
