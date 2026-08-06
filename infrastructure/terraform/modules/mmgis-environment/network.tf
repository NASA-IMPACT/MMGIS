# Three security groups govern this environment, but only two are ours to
# create. The third — the admin service's ALB security group — is created,
# owned, and populated by ECS Express Mode via the infrastructure role, and is
# not this module's to touch at all: it already admits the traffic CloudFront's
# VPC-origin ENIs send (bottom of this file). No hand-executed mutation
# remains.

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

# No ingress rule on the ECS-managed ALB security group: Express Mode
# provisions that SG with :80/:443 already open (0.0.0.0/0 and ::/0, plus the
# VPC CIDR — the ALB is internal, so "anywhere" means in-VPC and peered
# networks), so CloudFront's VPC-origin ENIs reach the ALB without any rule
# from this module. Declaring the same rule here fails the apply with
# InvalidPermission.Duplicate.
