terraform {
  # This root's state lives in the bootstrap bucket this root itself creates,
  # so the FIRST apply runs on local state and is migrated in immediately —
  # procedure in README.md. Bucket + region are supplied at init time because
  # they embed the never-committed account id.
  backend "s3" {
    key          = "bootstrap/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}
