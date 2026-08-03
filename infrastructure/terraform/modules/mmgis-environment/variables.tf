variable "environment" {
  description = "Environment name. Full word matching the deploy branch (development / production). Used as the mmgis-<env>-* naming prefix for every resource."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]*$", var.environment))
    error_message = "environment must be lowercase alphanumeric/hyphen (e.g. development, production)."
  }
}

variable "region" {
  description = "AWS region the environment is created in. Also the region used to build ARNs; must match the provider region."
  type        = string
}

# ── Network (operator-provided; the account cannot create VPCs/subnets) ──

variable "vpc_id" {
  description = "Existing VPC id the environment runs in. Supplied via uncommitted tfvars."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet ids for the Express service and the publish task. At least two (different AZs) are required by ECS Express Mode. Private subnets keep the admin reachable only through CloudFront."
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_ids) >= 2
    error_message = "ECS Express Mode requires at least two subnets in different AZs."
  }
}

# ── Compute sizing ──

variable "admin_cpu" {
  description = "CPU units for the admin Express service task."
  type        = string
  default     = "1024"
}

variable "admin_memory" {
  description = "Memory (MiB) for the admin Express service task."
  type        = string
  default     = "2048"
}

variable "publish_cpu" {
  description = "CPU units for the publish task (generous: it runs an in-task webpack static build)."
  type        = string
  default     = "2048"
}

variable "publish_memory" {
  description = "Memory (MiB) for the publish task."
  type        = string
  default     = "8192"
}

# ── RDS ──

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t3.micro"
}

variable "db_allocated_storage" {
  description = "RDS allocated storage in GiB."
  type        = number
  default     = 20
}

variable "db_engine_version" {
  description = "PostgreSQL major (or major.minor) version. 17 is the production-tested conservative baseline."
  type        = string
  default     = "17"
}

variable "db_backup_retention_period" {
  description = "RDS automated backup retention in days."
  type        = number
  default     = 7
}

variable "db_multi_az" {
  description = "Whether to run RDS Multi-AZ."
  type        = bool
  default     = false
}

variable "db_skip_final_snapshot" {
  description = "Whether to skip the final snapshot on RDS deletion. Development (disposable) may set true; production should keep false."
  type        = bool
  default     = false
}

variable "rds_ca_bundle_base64" {
  description = "base64 of the per-region RDS CA bundle (truststore.pki.rds.amazonaws.com/<region>/<region>-bundle.pem). RDS forces SSL; both task defs set DB_SSL=true + DB_SSL_CERT_BASE64. Public data, but region-specific and bulky, so it is supplied via tfvars rather than committed. Use the REGIONAL bundle — the global bundle exceeds the ECS env-var size limit."
  type        = string
}

# ── Log retention ──

variable "log_retention_days" {
  description = "CloudWatch Logs retention (days) for both log groups."
  type        = number
  default     = 30
}

# ── ECR ──

variable "ecr_force_delete" {
  description = "Whether the ECR repository can be deleted while it still holds images."
  type        = bool
  default     = false
}

# ── CloudFront two-phase inputs ──
# The Express service's internal ALB ARN and on.aws endpoint are NOT exposed
# as Terraform attributes of aws_ecs_express_gateway_service (only service_arn
# and ingress_paths are). The CloudFront VPC origin needs the ALB ARN and the
# distribution's admin origin needs the on.aws host name, so the CloudFront
# front door is created in a SECOND apply: phase 1 creates the service; the
# operator reads these two values (see README) and re-applies to build the
# VPC origin + distribution.

variable "express_internal_alb_arn" {
  description = "Phase 2. ARN of the internal ALB that ECS Express Mode provisioned for the admin service. Read from `aws ecs describe-express-gateway-service` after phase 1. Empty in phase 1."
  type        = string
  default     = ""
}

variable "express_onaws_endpoint" {
  description = "Phase 2. The Express service's on.aws endpoint host (mm-<hash>.ecs.<region>.on.aws) from ingress_paths / describe-express-gateway-service. Becomes the CloudFront admin origin DomainName. Empty in phase 1."
  type        = string
  default     = ""
}

variable "express_alb_security_group_id" {
  description = "Phase 2. Security-group id of the ECS-managed ALB fronting the admin service (from the same describe-express-gateway-service call as the ALB ARN). Drives the :443-from-VPC-CIDR ingress rule. Empty in phase 1."
  type        = string
  default     = ""
}

variable "overwrite_demo_mission" {
  description = "When true, sets OVERWRITE_DEMO_MISSION=true on the admin task (task definition + Express primary container) so each boot re-seeds the demo mission. Development only; never set in production. Publish task unaffected."
  type        = bool
  default     = false
}

variable "secret_recovery_window_days" {
  description = "Secrets Manager recovery window on delete. 0 frees the secret names immediately, so a destroy/re-apply cycle never collides with a ghost name still held in a recovery window. Both environments deliberately run 0."
  type        = number
  default     = 0
}
