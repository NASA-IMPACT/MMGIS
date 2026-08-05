data "aws_caller_identity" "current" {}

data "aws_vpc" "this" {
  id = var.vpc_id
}

locals {
  account_id  = data.aws_caller_identity.current.account_id
  region      = var.region
  name_prefix = "mmgis-${var.environment}"

  # Task-definition family names are region-global, so they carry the
  # per-environment prefix. This is what stops a production deploy from
  # registering a revision that development's publish-by-family flow picks up.
  admin_family   = "${local.name_prefix}-admin"
  publish_family = "${local.name_prefix}-publish"

  cluster_name = local.name_prefix
  service_name = "${local.name_prefix}-admin"

  admin_log_group   = "/ecs/${local.name_prefix}-admin"
  publish_log_group = "/ecs/${local.name_prefix}-publish"

  # S3 bucket names are global; qualify with the account id.
  asset_bucket_name = "${local.name_prefix}-assets-${local.account_id}"

  # Secret paths (path-style, per account convention). Shells only — values
  # are set out-of-band and never pass through Terraform state.
  secret_session_name   = "mmgis/${var.environment}/session-secret"
  secret_seed_user_name = "mmgis/${var.environment}/superadmin-username"
  secret_seed_pass_name = "mmgis/${var.environment}/superadmin-password"
  secret_dash_pass_name = "mmgis/${var.environment}/dashboards-password"
  secret_mapbox_name    = "mmgis/${var.environment}/mapbox-token"

  # The CloudFront front door is created only once its two-phase inputs are known.
  enable_cloudfront = var.express_internal_alb_arn != "" && var.express_onaws_endpoint != ""

  # AWS managed policy ids (region-independent), pinned by the recipes.
  cache_policy_caching_disabled      = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
  cache_policy_caching_optimized     = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  origin_request_all_except_host_hdr = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
}
