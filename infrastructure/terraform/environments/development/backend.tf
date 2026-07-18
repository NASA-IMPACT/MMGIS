terraform {
  # Development keeps its Terraform state in its OWN dedicated bucket; applying
  # one environment can never touch another's state. The bucket is bootstrapped
  # once, out-of-band (see infrastructure/README.md) — this config never creates
  # it. Bucket + region are supplied at init time via -backend-config so no
  # account-specific value is committed:
  #   terraform init -backend-config=backend.hcl
  backend "s3" {
    key          = "mmgis/development/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}
