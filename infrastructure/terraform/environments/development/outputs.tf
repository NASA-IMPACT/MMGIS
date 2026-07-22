output "workflow_variables" {
  description = "Values to set as the environment's GitHub Actions variables/secrets."
  value = {
    AWS_REGION          = module.mmgis.aws_region
    ECR_REPOSITORY      = module.mmgis.ecr_repository_name
    ECS_CLUSTER         = module.mmgis.ecs_cluster_name
    ECS_SERVICE         = module.mmgis.ecs_service_name
    ADMIN_TASK_FAMILY   = module.mmgis.admin_task_family
    PUBLISH_TASK_FAMILY = module.mmgis.publish_task_family
    AWS_DEPLOY_ROLE_ARN = module.mmgis.deploy_role_arn
  }
}

output "express_ingress_paths" {
  description = "Read the on.aws endpoint here for the phase-2 CloudFront apply."
  value       = module.mmgis.express_ingress_paths
}

output "express_service_arn" {
  value = module.mmgis.express_service_arn
}

output "rds_endpoint" {
  value = module.mmgis.rds_endpoint
}

output "rds_managed_master_secret_arn" {
  value = module.mmgis.rds_managed_master_secret_arn
}

output "app_db_secret_arn" {
  value = module.mmgis.app_db_secret_arn
}

output "asset_bucket_name" {
  value = module.mmgis.asset_bucket_name
}

output "admin_distribution_id" {
  value = module.mmgis.admin_distribution_id
}

output "admin_url" {
  value = module.mmgis.admin_url
}
