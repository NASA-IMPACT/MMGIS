module "mmgis" {
  source = "../../modules/mmgis-environment"

  environment = "development"
  region      = var.region

  # Network (uncommitted).
  vpc_id             = var.vpc_id
  private_subnet_ids = var.private_subnet_ids

  # RDS — development is disposable, so allow a clean teardown.
  db_instance_class      = "db.t3.micro"
  db_allocated_storage   = 20
  db_engine_version      = "17"
  db_multi_az            = false
  db_skip_final_snapshot = true
  rds_ca_bundle_base64   = var.rds_ca_bundle_base64

  # Re-seed the demo mission on every admin boot. Development only.
  overwrite_demo_mission = true

  # No recovery window: deleted secret names free immediately, so a
  # destroy/re-apply never collides with a name still held in recovery.
  secret_recovery_window_days = 0

  # CloudFront two-phase inputs (empty on the first apply).
  express_internal_alb_arn      = var.express_internal_alb_arn
  express_onaws_endpoint        = var.express_onaws_endpoint
  express_alb_security_group_id = var.express_alb_security_group_id
}
