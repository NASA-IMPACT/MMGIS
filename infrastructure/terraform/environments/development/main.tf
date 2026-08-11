module "mmgis" {
  source = "../../modules/mmgis-environment"

  environment = "development"
  region      = var.region

  # Network (uncommitted).
  vpc_id             = var.vpc_id
  private_subnet_ids = var.private_subnet_ids

  # Every role the module creates carries the account's boundary policy.
  permissions_boundary = var.permissions_boundary

  # The running image is CI's decision, handed in on every apply; empty only
  # under greenfield.
  deployed_image = var.deployed_image

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

  # The Express pair + the greenfield flag. All three live facts (this pair
  # and deployed_image above) are discovered per apply; empty values are only
  # legal under greenfield.
  greenfield               = var.greenfield
  express_internal_alb_arn = var.express_internal_alb_arn
  express_onaws_endpoint   = var.express_onaws_endpoint
}
