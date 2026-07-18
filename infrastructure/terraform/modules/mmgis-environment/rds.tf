resource "aws_db_subnet_group" "this" {
  name       = "${local.name_prefix}-db"
  subnet_ids = var.private_subnet_ids
}

resource "aws_db_instance" "this" {
  identifier     = "${local.name_prefix}-postgres"
  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  allocated_storage = var.db_allocated_storage
  storage_encrypted = true
  storage_type      = "gp3"

  # The master username MUST be `postgres`: scripts/init-db.js's bootstrap
  # connection defaults the maintenance database name to the username, and a
  # fresh RDS instance only has the `postgres` database. A non-postgres master
  # user fails the very first connection. Hard-coded, never a variable.
  username = "postgres"

  # RDS generates and rotates the master password in its OWN managed secret
  # (master_user_secret) — nothing lands in Terraform state. This satisfies
  # aws_db_instance's create-time password requirement without a
  # random_password. The app reads DB_PASS from the separate app-shaped secret
  # (secrets.tf), whose value is copied from this managed secret out-of-band.
  manage_master_user_password = true

  # db_name intentionally unset: the app's init defaults the maintenance DB to
  # the username (`postgres`), which already exists on a fresh instance.

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  port                   = 5432

  multi_az                = var.db_multi_az
  backup_retention_period = var.db_backup_retention_period

  # Guardrails: deletion protection is ON per the environment contract.
  deletion_protection       = true
  skip_final_snapshot       = var.db_skip_final_snapshot
  final_snapshot_identifier = var.db_skip_final_snapshot ? null : "${local.name_prefix}-postgres-final"

  apply_immediately = false
}
