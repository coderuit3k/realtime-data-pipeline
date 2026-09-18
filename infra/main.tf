terraform {
  required_version = ">= 1.5"

  # Shared with local dev AND GitHub Actions CI/CD -- created once by
  # infra-bootstrap/state_backend.tf. Without this, CI would start from an
  # empty local state and try to recreate everything that already exists.
  backend "s3" {
    bucket         = "realtime-data-pipeline-tfstate-541551608787"
    key            = "infra/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "realtime-data-pipeline-tfstate-lock"
    encrypt        = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

data "aws_caller_identity" "current" {}

locals {
  name_prefix = "${var.project_name}-${var.environment}"
}
