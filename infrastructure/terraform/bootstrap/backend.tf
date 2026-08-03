terraform {
  # The bootstrap's own state lives in the dedicated bootstrap state bucket
  # THIS root creates (mmgis-bootstrap-tfstate-<account_id>). Day one the
  # bucket doesn't exist yet, so the FIRST apply runs on a local state file
  # (via an uncommitted backend_override.tf) and is immediately migrated in
  # with `terraform init -migrate-state` — full procedure in README.md. A
  # state file left on a laptop is exactly the locked-up knowledge this
  # repo bans; the migration step is not optional.
  # Bucket + region are supplied at init time (they embed the account id,
  # which is never committed); both are derivable from `aws sts
  # get-caller-identity` — see README.md, no uncommitted config file needed.
  backend "s3" {
    key          = "bootstrap/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}
