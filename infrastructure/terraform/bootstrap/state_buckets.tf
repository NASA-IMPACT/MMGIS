# Terraform state homes. One bucket per environment and NOTHING shared:
# applying one environment can never touch another's state, because no CI role's
# policy names a bucket but its own. The bootstrap bucket is separate again —
# this root's state describes the CI roles themselves, so no CI-facing role is
# granted a single action against it; only the per-environment buckets ever
# appear in a CI role policy.
#
# DR posture: versioning is the recovery mechanism and state carries no secret
# values. See README.md ("Disaster-recovery posture") for what a total loss
# actually costs.

locals {
  # env key => bucket name; "bootstrap" rides along so every bucket gets
  # identical hardening from the same for_each resources.
  all_state_buckets = merge(local.state_bucket_names, { bootstrap = local.bootstrap_state_bucket })
}

resource "aws_s3_bucket" "state" {
  for_each = local.all_state_buckets
  bucket   = each.value

  # Deletion protection: state loss is survivable (see README.md) but never
  # acceptable by accident. Removing this guard is a deliberate two-step.
  lifecycle {
    prevent_destroy = true
  }
}

# Versioning is the disaster-recovery mechanism: every state revision stays
# recoverable, so a truncated or clobbered write is a rollback, not an outage.
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

# State is never public under any circumstance. Blocking it at the bucket level
# means no later bucket-policy mistake can expose it.
resource "aws_s3_bucket_public_access_block" "state" {
  for_each = aws_s3_bucket.state
  bucket   = each.value.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
