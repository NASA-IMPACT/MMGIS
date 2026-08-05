variable "environment" {
  description = "Environment name. Full word matching the deploy branch (development / production). Used as the mmgis-<env>-* naming prefix for every resource. Capped at 11 characters: longer names overflow the 63-char budget for the dashboard bucket names CloudFormation generates under the mmgis-<env>-dashboard-<id> stacks."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]*$", var.environment))
    error_message = "environment must be lowercase alphanumeric/hyphen (e.g. development, production)."
  }

  validation {
    # S3 bucket names cap at 63 chars and CloudFormation's auto-generated
    # dashboard bucket name is "<stack-name>-dashboardbucket-<13-char suffix>".
    # Truncation would eat the stack-name portion and break the module's
    # s3:::mmgis-<env>-dashboard-* IAM match. Budget: 63 total - 30 fixed
    # ("-dashboardbucket-" + 13-char suffix) - 17 ("mmgis-" + "-dashboard-")
    # - 5 (deployment-id digits, up to 99999) = 11 chars for the name.
    # "development" (11) and "production" (10) fit.
    condition     = length(var.environment) <= 11
    error_message = "environment must be 11 characters or fewer: longer names overflow the 63-char S3 bucket-name budget for mmgis-<env>-dashboard-<id> dashboard buckets."
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

# ── ECR / deployed image ──

variable "deployed_image" {
  description = "Full image reference (repo URL:tag) the environment is currently serving, discovered and supplied on every apply. Terraform never decides which image runs — the caller does. Empty is only legal with greenfield = true, where the nonexistent-placeholder fallback makes tasks crash-loop until the first image deploy later in the same run (documented, expected)."
  type        = string
  default     = ""

  validation {
    condition     = var.greenfield || var.deployed_image != ""
    error_message = "deployed_image is empty and greenfield is not set. Applying would register both task-definition families onto a placeholder tag that does not exist in ECR, and later publishes would hang silently. Discover the image the service is serving (recipe: infrastructure/README.md, \"Hand applies (break-glass)\") and pass it, or set greenfield = true only if this environment has never been fully built."
  }
}

variable "ecr_force_delete" {
  description = "Whether the ECR repository can be deleted while it still holds images."
  type        = bool
  default     = false
}

# ── IAM ──

variable "permissions_boundary" {
  description = "ARN of the IAM permissions-boundary policy attached to EVERY role this module creates. Required (no default): the CI pipeline's apply role is only allowed to create roles that carry a boundary, so an unboundaried role fails the very first apply. The boundary policy itself is created by the bootstrap root."
  type        = string

  validation {
    condition     = can(regex("^arn:aws:iam::[0-9]{12}:policy/", var.permissions_boundary))
    error_message = "permissions_boundary must be an IAM policy ARN (arn:aws:iam::<account>:policy/...)."
  }
}

# ── Express trio (discovered per apply) + the greenfield flag ──
# The Express service's internal ALB ARN and on.aws endpoint are NOT exposed
# as Terraform attributes of aws_ecs_express_gateway_service (only service_arn
# and ingress_paths are). The CloudFront VPC origin needs the ALB ARN and the
# distribution's admin origin needs the on.aws host name, so the CloudFront
# front door is created in a SECOND apply: phase 1 creates the service; CI
# reads these three values on every run; by hand they come from the README's
# Hand applies (break-glass) recipe. The second apply builds the VPC origin +
# distribution.

variable "greenfield" {
  description = "Set true ONLY for the first build of a brand-new environment (or a re-run continuing one). It is the sole way an apply may proceed with deployed_image or the three express_* inputs empty, and it accepts the documented consequences: task-definition families registered onto a placeholder tag until the first image deploy, and no CloudFront until the phase-2 apply. The CI pipeline sets it mechanically after verifying against live AWS that the missing facts genuinely do not exist yet. Never set it by hand against a live environment — and note the flag makes missing facts LEGAL, not SAFE: greenfield with a partial trio (ALB ARN and endpoint set, security-group id empty) keeps the distribution but drops the :443 ingress rule, and a live front door starts answering 504. Pass the trio complete or not at all."
  type        = bool
  default     = false
}

variable "express_internal_alb_arn" {
  description = "ARN of the internal ALB that ECS Express Mode provisioned for the admin service. Read from `aws ecs describe-service-revisions` on the service's newest revision. Empty only under greenfield = true (phase 1 of a first build)."
  type        = string
  default     = ""

  validation {
    condition     = var.greenfield || var.express_internal_alb_arn != ""
    error_message = "express_internal_alb_arn is empty and greenfield is not set. Against an environment whose CloudFront exists, applying without the full express trio destroys the distribution (it returns later on a NEW cloudfront.net domain). Discover the trio from the live service (recipe: infrastructure/README.md, \"Hand applies (break-glass)\"), or set greenfield = true only if this environment has never been fully built."
  }
}

variable "express_onaws_endpoint" {
  description = "The Express service's on.aws endpoint host (mm-<hash>.ecs.<region>.on.aws) from ingress_paths, or from `aws ecs describe-service-revisions` on the newest revision. Becomes the CloudFront admin origin DomainName. Empty only under greenfield = true (phase 1 of a first build)."
  type        = string
  default     = ""

  validation {
    condition     = var.greenfield || var.express_onaws_endpoint != ""
    error_message = "express_onaws_endpoint is empty and greenfield is not set. Against an environment whose CloudFront exists, applying without the full express trio destroys the distribution (it returns later on a NEW cloudfront.net domain). Discover the trio from the live service (recipe: infrastructure/README.md, \"Hand applies (break-glass)\"), or set greenfield = true only if this environment has never been fully built."
  }
}

variable "express_alb_security_group_id" {
  description = "Security-group id of the ECS-managed ALB fronting the admin service (from the same `aws ecs describe-service-revisions` call as the ALB ARN). Drives the :443-from-VPC-CIDR ingress rule. Empty only under greenfield = true (phase 1 of a first build)."
  type        = string
  default     = ""

  validation {
    condition     = var.greenfield || var.express_alb_security_group_id != ""
    error_message = "express_alb_security_group_id is empty and greenfield is not set. Applying without it drops the :443 ingress rule on the ECS-managed ALB security group and the CloudFront front door answers 504. Discover it from the live service (recipe: infrastructure/README.md, \"Hand applies (break-glass)\"), or set greenfield = true only if this environment has never been fully built."
  }
}

variable "overwrite_demo_mission" {
  description = "When true, sets OVERWRITE_DEMO_MISSION=true on the admin task (task definition + Express primary container) so each boot re-seeds the demo mission. Development only; never set in production. Publish task unaffected. Consumed by `scripts/init-db.js` at boot. The environment carries it so enabling needs no infrastructure change."
  type        = bool
  default     = false
}

variable "secret_recovery_window_days" {
  description = "Secrets Manager recovery window on delete. 0 frees the secret names immediately, so a destroy/re-apply cycle never collides with a ghost name still held in a recovery window. Both environments deliberately run 0."
  type        = number
  default     = 0
}
