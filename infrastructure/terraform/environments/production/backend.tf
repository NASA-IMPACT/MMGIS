terraform {
  # Production keeps its Terraform state in its OWN dedicated bucket, created
  # by the bootstrap root (terraform/bootstrap) — applying one environment can
  # never touch another's state. Bucket + region are supplied at init time via
  # -backend-config:
  #   terraform init -backend-config=backend.hcl
  backend "s3" {
    key          = "mmgis/production/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}
