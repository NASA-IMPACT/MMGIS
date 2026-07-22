module "mmgis" {
  source = "../../modules/mmgis-environment"

  environment = "production"
  region      = var.region

  # Network (uncommitted).
  vpc_id             = var.vpc_id
  private_subnet_ids = var.private_subnet_ids

  # RDS — runtime spec is IDENTICAL to development (the admin is internal
  # tooling; the shipped product is the published dashboards, which serve
  # independently of this stack). The environments differ only in DELETION
  # POLICY: production always leaves a final snapshot on destroy and keeps
  # the default 30-day secret recovery window, while development skips both
  # so destroy/rebuild cycles leave no residue.
  db_instance_class      = "db.t3.micro"
  db_allocated_storage   = 20
  db_engine_version      = "17"
  db_multi_az            = false
  db_skip_final_snapshot = false
  rds_ca_bundle_base64   = var.rds_ca_bundle_base64

  # CI deploy role. NOTE: branch-scoped for now; #195 tightens both environments
  # to GitHub-Environment-scoped trust when it wires `environment:` into the job.
  github_repo        = "NASA-IMPACT/MMGIS"
  deploy_role_branch = "production"

  # CloudFront two-phase inputs (empty on the first apply).
  express_internal_alb_arn      = var.express_internal_alb_arn
  express_onaws_endpoint        = var.express_onaws_endpoint
  express_alb_security_group_id = var.express_alb_security_group_id
}
