variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "github_org" {
  description = "GitHub org or user that owns the repo, e.g. \"thanhconl67\""
  type        = string
}

variable "github_repo" {
  description = "Repo name, e.g. \"realtime-data-pipeline\""
  type        = string
}

variable "role_name" {
  type    = string
  default = "realtime-data-pipeline-github-deploy"
}

variable "project_name" {
  description = "Must match infra/variables.tf's project_name -- scopes iam:PassRole to this project's own roles only"
  type        = string
  default     = "realtime-data-pipeline"
}
