# Only values that must NOT be committed (network ids, the two-phase CloudFront
# inputs, the CA bundle) are variables. Everything safe to commit is set inline
# in the module call (main.tf). Supply these via an uncommitted terraform.tfvars
# (see terraform.tfvars.example).

variable "region" {
  description = "AWS region. Safe to commit as a default; override in tfvars if needed."
  type        = string
  default     = "us-west-2"
}

variable "vpc_id" {
  description = "Existing VPC id for the development environment."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet ids (>= 2, different AZs) for the Express service and publish task."
  type        = list(string)
}

variable "rds_ca_bundle_base64" {
  description = "base64 of the region's RDS CA bundle (public, region-specific)."
  type        = string
}

variable "express_internal_alb_arn" {
  description = "Phase 2 only. Internal ALB ARN from `aws ecs describe-express-gateway-service`. Leave empty for the first apply."
  type        = string
  default     = ""
}

variable "express_onaws_endpoint" {
  description = "Phase 2 only. The on.aws endpoint host from the Express service. Leave empty for the first apply."
  type        = string
  default     = ""
}
