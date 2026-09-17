# The role CloudFront runs VPC origins under. It is account-global — one role
# serves both environments' distributions — and CloudFront creates it
# implicitly the first time anyone in the account creates a VPC origin. Owned
# here because the alternative is an iam:CreateServiceLinkedRole grant on the
# CI apply roles, reaching outside the mmgis-<env>-* name fence every other IAM
# write they hold respects.
resource "aws_iam_service_linked_role" "cloudfront_vpc_origin" {
  aws_service_name = "vpcorigin.cloudfront.amazonaws.com"

  # Deleting this role takes every VPC origin in the account with it, in both
  # environments at once, and no CI role can recreate it. Removing this guard
  # is a deliberate two-step (edit, then destroy).
  lifecycle {
    prevent_destroy = true
  }
}
