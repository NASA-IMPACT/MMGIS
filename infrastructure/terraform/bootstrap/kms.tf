# Encryption key for the RDS-managed master password secrets. The account's
# default aws/secretsmanager key cannot serve: an AWS-managed key policy
# delegates only metadata actions to identity policies, so no IAM grant on the
# apply role authorizes the CreateDBInstance call that asks RDS to encrypt a
# managed master secret with it, and CreateDBInstance fails with
# KMSKeyNotAccessibleFault. A customer-managed key delegates authorization to
# IAM, which the grants below and in the environment module then supply.
#
# One key for both environments: its only consumers are the per-environment
# master secrets and the roles listed here, and no environment reaches the
# other's secret (Secrets Manager scoping does that, in boundary.tf).
resource "aws_kms_key" "master_secret" {
  description             = "Encrypts the RDS-managed master password secrets for every MMGIS environment. Owned here so the CI apply roles can be granted on it; the account's default aws/secretsmanager key cannot be."
  enable_key_rotation     = true
  deletion_window_in_days = 30

  # The key an RDS-managed credential is encrypted with cannot be changed after
  # the fact, so scheduling this key for deletion leaves both environments'
  # master secrets permanently undecryptable and both databases unreachable.
  # Removing this guard is a deliberate two-step (edit, then destroy).
  lifecycle {
    prevent_destroy = true
  }

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # The standard root delegation. Its effect is not to hand the account
        # broad power over the key but to make IAM policies an authorization
        # path for it at all: without this statement the key is reachable only
        # through its own policy, and every identity-based grant is inert.
        Sid       = "EnableIamPolicyAuthorization"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${local.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
    ]
  })
}

# The alias is the committed contract: the environment module looks the key up
# by this exact name, so nothing downstream needs the (uncommitted) key id.
resource "aws_kms_alias" "master_secret" {
  name          = "alias/mmgis-master-secret"
  target_key_id = aws_kms_key.master_secret.key_id
}
