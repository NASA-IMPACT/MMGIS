# Secret SHELLS only. Terraform defines the secrets' existence and names; the
# VALUES are set out-of-band (see README) and never pass through Terraform
# state. There is deliberately NO aws_secretsmanager_secret_version and NO
# random_password resource anywhere in this module — either would land a
# secret value in state.

# express-session secret; injected as env SECRET (the name scripts/server.js reads).
resource "aws_secretsmanager_secret" "session" {
  name                    = local.secret_session_name
  description             = "MMGIS ${var.environment} express-session secret (injected as env SECRET). Value set out-of-band."
  recovery_window_in_days = var.secret_recovery_window_days
}

resource "aws_secretsmanager_secret" "seed_username" {
  name                    = local.secret_seed_user_name
  description             = "MMGIS ${var.environment} superadmin seed username (SEED_SUPERADMIN_USERNAME). Value set out-of-band."
  recovery_window_in_days = var.secret_recovery_window_days
}

resource "aws_secretsmanager_secret" "seed_password" {
  name                    = local.secret_seed_pass_name
  description             = "MMGIS ${var.environment} superadmin seed password (SEED_SUPERADMIN_PASSWORD). Value set out-of-band."
  recovery_window_in_days = var.secret_recovery_window_days
}

# Shared dashboards password; injected only on the publish task (MMGIS_DASHBOARDS_PASSWORD).
resource "aws_secretsmanager_secret" "dashboards_password" {
  name                    = local.secret_dash_pass_name
  description             = "MMGIS ${var.environment} shared dashboards password (MMGIS_DASHBOARDS_PASSWORD). Value set out-of-band."
  recovery_window_in_days = var.secret_recovery_window_days
}
