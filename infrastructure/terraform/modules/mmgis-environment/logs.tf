# Pre-created log groups. The execution roles deliberately omit
# logs:CreateLogGroup, so these must exist before a task runs.
resource "aws_cloudwatch_log_group" "admin" {
  name              = local.admin_log_group
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "publish" {
  name              = local.publish_log_group
  retention_in_days = var.log_retention_days
}
