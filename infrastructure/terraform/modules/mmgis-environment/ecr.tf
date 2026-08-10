# Per-environment ECR repository. Nothing is shared between environments.
resource "aws_ecr_repository" "this" {
  name                 = local.name_prefix
  image_tag_mutability = "MUTABLE"
  force_delete         = var.ecr_force_delete

  image_scanning_configuration {
    scan_on_push = true
  }
}
