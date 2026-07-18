locals {
  placeholder_image = "${aws_ecr_repository.this.repository_url}:latest"
  db_secret_arn     = aws_secretsmanager_secret.db.arn

  # DB credentials are injected per-JSON-key from the app-shaped DB secret.
  db_secrets = [
    { name = "DB_HOST", value_from = "${local.db_secret_arn}:DB_HOST::" },
    { name = "DB_PORT", value_from = "${local.db_secret_arn}:DB_PORT::" },
    { name = "DB_NAME", value_from = "${local.db_secret_arn}:DB_NAME::" },
    { name = "DB_USER", value_from = "${local.db_secret_arn}:DB_USER::" },
    { name = "DB_PASS", value_from = "${local.db_secret_arn}:DB_PASS::" },
  ]

  admin_secrets = concat(local.db_secrets, [
    # env name SECRET is what scripts/server.js reads (not SESSION_SECRET).
    { name = "SECRET", value_from = aws_secretsmanager_secret.session.arn },
    { name = "SEED_SUPERADMIN_USERNAME", value_from = aws_secretsmanager_secret.seed_username.arn },
    { name = "SEED_SUPERADMIN_PASSWORD", value_from = aws_secretsmanager_secret.seed_password.arn },
  ])

  publish_secrets = concat(local.db_secrets, [
    { name = "MMGIS_DASHBOARDS_PASSWORD", value_from = aws_secretsmanager_secret.dashboards_password.arn },
  ])

  admin_environment = [
    { name = "MMGIS_DEPLOYMENT_MODE", value = "lean" },
    { name = "DISABLE_FIRST_SIGNUP", value = "true" },
    { name = "ENABLE_MMGIS_WEBSOCKETS", value = "true" },
    { name = "ENABLE_CONFIG_WEBSOCKETS", value = "true" },
    { name = "NODE_ENV", value = "production" },
    { name = "PORT", value = "8888" },
    { name = "AUTH", value = "local" },
    { name = "DB_SSL", value = "true" },
    { name = "DB_SSL_CERT_BASE64", value = var.rds_ca_bundle_base64 },
    { name = "AWS_REGION", value = local.region },
    { name = "MMGIS_PUBLISH_ECS_CLUSTER", value = local.cluster_name },
    { name = "MMGIS_PUBLISH_TASK_DEFINITION", value = local.publish_family },
    { name = "MMGIS_PUBLISH_SUBNETS", value = join(",", var.private_subnet_ids) },
    { name = "MMGIS_PUBLISH_SECURITY_GROUPS", value = aws_security_group.service.id },
    { name = "MMGIS_PUBLISH_CONTAINER_NAME", value = "mmgis" },
    { name = "MMGIS_SHARED_ASSET_BUCKET", value = local.asset_bucket_name },
  ]

  publish_environment = [
    { name = "MMGIS_DEPLOYMENT_MODE", value = "lean" },
    { name = "NODE_ENV", value = "production" },
    { name = "DB_SSL", value = "true" },
    { name = "DB_SSL_CERT_BASE64", value = var.rds_ca_bundle_base64 },
    { name = "AWS_REGION", value = local.region },
    { name = "MMGIS_SHARED_ASSET_BUCKET", value = local.asset_bucket_name },
  ]
}

resource "aws_ecs_cluster" "this" {
  name = local.cluster_name
}

# ── Admin task definition ──
# The Express service (below) runs from its own primary_container, NOT from
# this task def. We register it anyway as the human-auditable source-of-truth
# the primary container mirrors, and the deploy workflow registers new
# revisions of it per release.
resource "aws_ecs_task_definition" "admin" {
  family                   = local.admin_family
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.admin_cpu
  memory                   = var.admin_memory
  execution_role_arn       = aws_iam_role.admin_exec.arn
  task_role_arn            = aws_iam_role.admin_task.arn

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([{
    name         = "mmgis"
    image        = local.placeholder_image
    essential    = true
    portMappings = [{ containerPort = 8888, protocol = "tcp" }]
    environment  = local.admin_environment
    secrets      = [for s in local.admin_secrets : { name = s.name, valueFrom = s.value_from }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = local.admin_log_group
        "awslogs-region"        = local.region
        "awslogs-stream-prefix" = "mmgis-admin"
      }
    }
  }])

  depends_on = [aws_cloudwatch_log_group.admin]
}

# ── Publish task definition ──
# Genuinely load-bearing: the Deployments backend starts publish jobs with
# RunTask on the bare family name, which resolves to the latest revision.
resource "aws_ecs_task_definition" "publish" {
  family                   = local.publish_family
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.publish_cpu
  memory                   = var.publish_memory
  execution_role_arn       = aws_iam_role.publish_exec.arn
  task_role_arn            = aws_iam_role.publish_task.arn

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([{
    name        = "mmgis"
    image       = local.placeholder_image
    essential   = true
    command     = ["node", "scripts/publish-static.js"]
    environment = local.publish_environment
    secrets     = [for s in local.publish_secrets : { name = s.name, valueFrom = s.value_from }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = local.publish_log_group
        "awslogs-region"        = local.region
        "awslogs-stream-prefix" = "mmgis-publish"
      }
    }
  }])

  depends_on = [aws_cloudwatch_log_group.publish]
}

# ── Admin Express Mode gateway service ──
# Express Mode owns the ALB, target groups, rollout strategy, and scaling — no
# ALB/target-group/scaling resources are defined here (D1). Passing private
# subnets yields a PRIVATE endpoint + internal ALB, so the only path in is
# CloudFront -> VPC origin -> internal ALB -> task.
resource "aws_ecs_express_gateway_service" "admin" {
  service_name            = local.service_name
  cluster                 = aws_ecs_cluster.this.name
  execution_role_arn      = aws_iam_role.admin_exec.arn
  task_role_arn           = aws_iam_role.admin_task.arn
  infrastructure_role_arn = aws_iam_role.express_infra.arn
  cpu                     = var.admin_cpu
  memory                  = var.admin_memory
  health_check_path       = "/api/utils/healthcheck"

  primary_container {
    image          = local.placeholder_image
    container_port = 8888

    aws_logs_configuration {
      log_group         = local.admin_log_group
      log_stream_prefix = "mmgis-admin"
    }

    dynamic "environment" {
      for_each = local.admin_environment
      content {
        name  = environment.value.name
        value = environment.value.value
      }
    }

    dynamic "secret" {
      for_each = local.admin_secrets
      content {
        name       = secret.value.name
        value_from = secret.value.value_from
      }
    }
  }

  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [aws_security_group.service.id]
  }

  lifecycle {
    # The deploy workflow rolls the service by updating the primary container's
    # image out-of-band; do not let Terraform revert it to the placeholder.
    ignore_changes = [primary_container[0].image]
  }

  # Prevent the delete-time race the provider warns about (service stuck
  # DRAINING if its policies are destroyed first).
  depends_on = [
    aws_iam_role_policy.admin_exec,
    aws_iam_role_policy.admin_task,
    aws_iam_role_policy_attachment.express_infra,
    aws_cloudwatch_log_group.admin,
  ]
}
