# Three security groups govern this environment, but only two are ours to
# create. The third — the admin service's ALB security group — is created and
# owned by ECS Express Mode via the infrastructure role and CANNOT be created
# here. It does need a :443 ingress rule from the VPC CIDR so CloudFront's
# VPC-origin ENIs can reach the ALB. The SG id is only knowable once the
# service is up, so that rule is a PHASE-2 resource (bottom of this file),
# driven by var.express_alb_security_group_id — read from the same
# describe-service-revisions call as the ALB ARN. No hand-executed
# mutation remains.

# Shared task security group — used by BOTH the admin service and the publish
# task (RunTask). The RDS ingress rule references this SG, so sharing it is what
# lets one rule cover both database clients.
resource "aws_security_group" "service" {
  name        = "${local.name_prefix}-service-sg"
  description = "MMGIS ${var.environment} admin + publish tasks: ingress 8888 from the in-VPC ALB, egress all."
  vpc_id      = var.vpc_id

  ingress {
    description = "App port from the ECS-managed ALB (in-VPC)."
    from_port   = 8888
    to_port     = 8888
    protocol    = "tcp"
    cidr_blocks = [data.aws_vpc.this.cidr_block]
  }

  egress {
    description = "All outbound (image pull, AWS APIs, webhooks via NAT)."
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-service-sg" }
}

# Database security group — 5432 from the shared task SG only.
resource "aws_security_group" "rds" {
  name        = "${local.name_prefix}-rds-sg"
  description = "MMGIS ${var.environment} RDS: ingress 5432 from the task SG only."
  vpc_id      = var.vpc_id

  ingress {
    description     = "PostgreSQL from the admin/publish task SG."
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.service.id]
  }

  tags = { Name = "${local.name_prefix}-rds-sg" }
}

# Phase 2: allow CloudFront's VPC-origin ENIs (in-VPC) to reach the
# ECS-managed ALB on :443. The ALB SG is Express-Mode-owned, but adding a rule
# to it is fair game — only creation/deletion of the SG belongs to ECS.
resource "aws_vpc_security_group_ingress_rule" "express_alb_https" {
  count = var.express_alb_security_group_id != "" ? 1 : 0

  security_group_id = var.express_alb_security_group_id
  description       = "HTTPS from in-VPC CloudFront VPC-origin ENIs (MMGIS ${var.environment})."
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = data.aws_vpc.this.cidr_block
}
