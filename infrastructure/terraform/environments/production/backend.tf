terraform {
  # Production keeps its Terraform state in its OWN dedicated bucket, created
  # by the bootstrap root (terraform/bootstrap) — applying one environment can
  # never touch another's state. Bucket + region are supplied at init time so
  # no account-specific value is committed (CI reads them from the
  # Environment's IAC_TFSTATE_BUCKET and IAC_AWS_REGION; by hand, see the
  # README's Hand applies (break-glass) section):
  #   terraform init -backend-config="bucket=..." -backend-config="region=..."
  backend "s3" {
    key          = "mmgis/production/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}
