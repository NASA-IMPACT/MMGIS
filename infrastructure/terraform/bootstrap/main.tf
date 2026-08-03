data "aws_caller_identity" "current" {}

# Reference the account's existing GitHub OIDC provider — never create it here.
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

locals {
  account_id = data.aws_caller_identity.current.account_id
  region     = var.region

  # The two CI-driven environments. GitHub Environment names match exactly —
  # the OIDC subject of an environment-bound job is
  # repo:<owner/name>:environment:<env>, and renaming an Environment breaks
  # every AssumeRoleWithWebIdentity here.
  environments = toset(["development", "production"])

  # Committed pattern + the account id of whoever is logged in — bucket names
  # are S3-global, so they carry the account id, but nothing account-
  # identifying is committed.
  state_bucket_names     = { for env in local.environments : env => "mmgis-${env}-tfstate-${local.account_id}" }
  bootstrap_state_bucket = "mmgis-bootstrap-tfstate-${local.account_id}"

  # OIDC subjects. The audience is always sts.amazonaws.com for GitHub's
  # provider; the subject is what actually pins who may assume what.
  oidc_aud         = "sts.amazonaws.com"
  environment_subs = { for env in local.environments : env => "repo:${var.github_repo}:environment:${env}" }
  pull_request_sub = "repo:${var.github_repo}:pull_request"
}
