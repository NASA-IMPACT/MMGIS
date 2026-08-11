provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "MMGIS"
      Environment = "development"
      ManagedBy   = "Terraform"
    }
  }
}
