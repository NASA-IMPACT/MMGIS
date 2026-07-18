terraform {
  # Production keeps its Terraform state in its OWN dedicated bucket. Its
  # bootstrap belongs to #195 (this issue creates nothing production-flavored in
  # the account); the config exists here so #195 can instantiate it. Bucket +
  # region are supplied at init time via -backend-config:
  #   terraform init -backend-config=backend.hcl
  backend "s3" {
    key          = "mmgis/production/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}
