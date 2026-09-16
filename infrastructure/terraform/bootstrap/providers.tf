provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "MMGIS"
      Component = "bootstrap"
      ManagedBy = "Terraform"
    }
  }
}
