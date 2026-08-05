# Terraform state homes: one bucket per environment plus a separate bootstrap
# bucket that no CI role can touch. State/bootstrap model and DR posture:
# docs/infrastructure/README.md.

locals {
  # "bootstrap" rides along so every bucket gets identical hardening from the
  # same for_each resources.
  all_state_buckets = merge(local.state_bucket_names, { bootstrap = local.bootstrap_state_bucket })
}

resource "aws_s3_bucket" "state" {
  for_each = local.all_state_buckets
  bucket   = each.value

  # State loss must never be accidental; removing this guard is a deliberate
  # two-step (edit, then destroy).
  lifecycle {
    prevent_destroy = true
  }
}

# Versioning is the disaster-recovery mechanism: a truncated or clobbered
# write is a rollback, not an outage.
resource "aws_s3_bucket_versioning" "state" {
  for_each = aws_s3_bucket.state
  bucket   = each.value.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  for_each = aws_s3_bucket.state
  bucket   = each.value.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Blocking public access at the bucket level means no later bucket-policy
# mistake can expose state.
resource "aws_s3_bucket_public_access_block" "state" {
  for_each = aws_s3_bucket.state
  bucket   = each.value.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
