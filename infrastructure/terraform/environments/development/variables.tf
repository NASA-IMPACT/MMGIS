# Only values that must NOT be committed (network ids, the discovered live
# facts, the CA bundle) are variables. Everything safe to commit is set inline
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
  description = "The image the environment is currently serving, supplied on every apply (CI: TF_VAR_deployed_image; hand runs: discover it per the README's break-glass recipe). Empty only under greenfield = true."
  type        = string
  default     = ""
}

variable "permissions_boundary" {
  description = "ARN of the account's IAM permissions-boundary policy (created by the bootstrap root). Carries the account id, so it is supplied via uncommitted tfvars."
  type        = string
}

variable "express_internal_alb_arn" {
  description = "Internal ALB ARN from the live service (README break-glass recipe). Empty only under greenfield = true."
  type        = string
  default     = ""
}

variable "express_onaws_endpoint" {
  description = "The on.aws endpoint host from the live service. Empty only under greenfield = true."
  type        = string
  default     = ""
}

variable "express_alb_security_group_id" {
  description = "SG id of the ECS-managed ALB (same describe as the ALB ARN). Empty only under greenfield = true — and never empty while the other two are set (that drops the :443 ingress rule)."
  type        = string
  default     = ""
}

variable "greenfield" {
  description = "First build of a brand-new environment only. The sole way an apply may proceed with deployed_image or the express_* inputs empty. CI sets it (TF_VAR_greenfield) after verifying the environment has never been fully built; never set it by hand against a live environment."
  type        = bool
  default     = false
}
