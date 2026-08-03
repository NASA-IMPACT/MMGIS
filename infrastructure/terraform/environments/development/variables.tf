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

variable "deployed_image" {
  description = "Supplied by the CI pipeline (TF_VAR_deployed_image). Leave unset for hand runs / first-ever apply."
  type        = string
  default     = ""
}

variable "permissions_boundary" {
  description = "ARN of the account's IAM permissions-boundary policy (created by the bootstrap root). Carries the account id, so it is supplied via uncommitted tfvars."
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

variable "express_alb_security_group_id" {
  description = "Phase 2. SG id of the ECS-managed ALB (same describe call as the ALB ARN). Empty in phase 1."
  type        = string
  default     = ""
}
