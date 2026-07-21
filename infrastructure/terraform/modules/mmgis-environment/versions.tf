terraform {
  # aws_ecs_express_gateway_service and aws_cloudfront_vpc_origin are both
  # required; the Express Mode resource landed in the AWS provider at 6.22.0.
  required_version = ">= 1.11.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.22.0"
    }
  }
}
