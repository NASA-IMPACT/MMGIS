variable "region" {
  description = "AWS region for the state buckets and all regional ARNs baked into the role policies. Safe to commit as a default."
  type        = string
  default     = "us-west-2"
}

variable "github_repo" {
  description = "owner/name of the GitHub repository whose Actions runs may assume the OIDC roles."
  type        = string
  default     = "NASA-IMPACT/MMGIS"
}
