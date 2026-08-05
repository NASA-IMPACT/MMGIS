# CloudFront front door — PHASE 2. Created only once express_internal_alb_arn
# and express_onaws_endpoint are supplied (see variables.tf and the README's
# Hand applies (break-glass) section). The Express service does not expose its
# internal ALB ARN as a Terraform attribute, so the VPC origin cannot be wired
# directly; the two values are read from
# `aws ecs describe-service-revisions` on the newest service revision after
# phase 1.

resource "aws_cloudfront_vpc_origin" "admin" {
  count = local.enable_cloudfront ? 1 : 0

  vpc_origin_endpoint_config {
    name                   = "${local.name_prefix}-admin-vpc-origin"
    arn                    = var.express_internal_alb_arn
    http_port              = 80
    https_port             = 443
    origin_protocol_policy = "https-only"

    origin_ssl_protocols {
      items    = ["TLSv1.2"]
      quantity = 1
    }
  }
}

resource "aws_cloudfront_distribution" "admin" {
  count = local.enable_cloudfront ? 1 : 0

  enabled      = true
  http_version = "http2"
  comment      = "MMGIS ${var.environment} admin distribution (bare-CloudFront posture: default viewer cert, no aliases)."

  # Admin origin: the Express service's internal ALB via a VPC origin. The
  # DomainName MUST be the on.aws endpoint (it satisfies the ALB cert's SNI and
  # its host-header rule); the raw ALB DNS name would miss the host rule.
  origin {
    origin_id   = "AdminExpressVpcOrigin"
    domain_name = var.express_onaws_endpoint

    vpc_origin_config {
      vpc_origin_id = aws_cloudfront_vpc_origin.admin[0].id
    }
  }

  # Asset bucket origin, locked to CloudFront via OAC.
  origin {
    origin_id                = "AssetBucketOrigin"
    domain_name              = aws_s3_bucket.assets.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.assets.id
  }

  # Default behavior: full forwarding (login, Postgres-backed sessions,
  # WebSocket upgrade) via AllViewerExceptHostHeader — CloudFront rewrites Host
  # to the origin's on.aws name so the ALB host rule matches. CachingDisabled
  # keeps auth/sessions correct.
  default_cache_behavior {
    target_origin_id         = "AdminExpressVpcOrigin"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = local.cache_policy_caching_disabled
    origin_request_policy_id = local.origin_request_all_except_host_hdr
  }

  # /assets/* serves admin-uploaded images same-origin from the shared bucket.
  ordered_cache_behavior {
    path_pattern           = "/assets/*"
    target_origin_id       = "AssetBucketOrigin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = local.cache_policy_caching_optimized
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
      locations        = []
    }
  }

  # Bare posture: default *.cloudfront.net certificate, no aliases. Note the
  # recipe JSON's MinimumProtocolVersion is intentionally dropped — the
  # provider forbids setting it alongside the default certificate (which pins
  # TLSv1 on the viewer side).
  viewer_certificate {
    cloudfront_default_certificate = true
  }

  lifecycle {
    # A destroyed distribution is not recoverable in place: a recreate returns
    # on a NEW cloudfront.net domain, changing the admin URL and every
    # published dashboard's origin expectations. This blocks any plan that
    # destroys it — including the count 1 -> 0 flip an empty ALB ARN or
    # endpoint causes — independent of the greenfield flag. The VPC origin
    # and the :443 ingress rule deliberately do NOT carry this: when ECS
    # swaps the ALB they may be replaced or updated in place, and either way
    # they must not be pinned. To intentionally destroy the environment,
    # edit this line to false in a working copy (lifecycle arguments must be
    # literals) and never commit that edit. The protection only holds while
    # this resource block exists in configuration.
    prevent_destroy = true
  }
}
