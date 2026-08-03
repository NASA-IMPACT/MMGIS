module "mmgis" {
  source = "../../modules/mmgis-environment"

  environment = "production"
  region      = var.region

  # Network (uncommitted).
  vpc_id             = var.vpc_id
  private_subnet_ids = var.private_subnet_ids

  # Every role the module creates carries the account's boundary policy.
  permissions_boundary = var.permissions_boundary

  # RDS — runtime spec is IDENTICAL to development (the admin is internal
  # tooling; the shipped product is the published dashboards, which serve
  # independently of this stack). The environments differ only in DELETION
  # POLICY: production always leaves a final snapshot on destroy, while
  # development skips it so destroy/rebuild cycles leave no residue. Secret
  # recovery windows are 0 in BOTH (below).
  db_instance_class      = "db.t3.micro"
  db_allocated_storage   = 20
  db_engine_version      = "17"
  db_multi_az            = false
  db_skip_final_snapshot = false
  rds_ca_bundle_base64   = var.rds_ca_bundle_base64

  # No recovery window, production included: deleted secret names free
  # immediately, so a destroy/re-apply never collides with a name still held
  # in recovery. One nuance this accepts: the superadmin seed password only
  # seeds the account at FIRST boot — after that the real credential is a
  # password hash in the database, so destroying and regenerating the secret
  # desyncs the stored value from the actual login password. Deliberate, rare,
  # and documented — not a blocker.
  secret_recovery_window_days = 0

  # CloudFront two-phase inputs (empty on the first apply).
  express_internal_alb_arn      = var.express_internal_alb_arn
  express_onaws_endpoint        = var.express_onaws_endpoint
  express_alb_security_group_id = var.express_alb_security_group_id
}
