# Shared admin asset bucket: one private bucket holding admin-uploaded mission
# assets (/assets/<mission>/...), served same-origin through the admin
# distribution's /assets/* behavior. The publish task same-key copies a
# mission's assets out of here into that dashboard's own bucket at publish.
resource "aws_s3_bucket" "assets" {
  bucket = local.asset_bucket_name
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket                  = aws_s3_bucket.assets.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Origin Access Control for the asset-bucket origin. Independent of the
# distribution, so created in phase 1 and referenced by the phase-2 distribution.
resource "aws_cloudfront_origin_access_control" "assets" {
  name                              = "${local.name_prefix}-assets-oac"
  description                       = "OAC for the ${var.environment} shared asset bucket origin."
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Bucket policy grants ONLY the admin distribution read access (AWS:SourceArn).
# It needs the distribution ARN, so it is created in phase 2 alongside the
# distribution. Ordering: OAC -> distribution -> THIS policy.
resource "aws_s3_bucket_policy" "assets" {
  count  = local.enable_cloudfront ? 1 : 0
  bucket = aws_s3_bucket.assets.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowAdminCloudFrontReadOnly"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.assets.arn}/*"
      Condition = {
        StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.admin[0].arn }
      }
    }]
  })
}
