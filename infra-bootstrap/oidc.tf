data "aws_caller_identity" "current" {}

data "tls_certificate" "github" {
  url = "https://token.actions.githubusercontent.com"
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github.certificates[0].sha1_fingerprint]
}

# Trust only THIS repo's workflows -- no other repo can assume this role.
data "aws_iam_policy_document" "github_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Confirmed via CloudTrail on a live rejected run: GitHub's current sub
    # claim is "repo:<org>@<org_id>/<repo>@<repo_id>:ref:refs/heads/<branch>"
    # -- it inserts "@<numeric id>" right after the org and repo names, not
    # just after the whole string. A plain "repo:org/repo:*" pattern (no
    # wildcard until after the colon) never matches that and silently
    # denies every assume-role call. Wildcard right after org/repo too so
    # this matches both this newer format and the older plain-name one.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_org}*/${var.github_repo}*:*"]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name               = var.role_name
  assume_role_policy = data.aws_iam_policy_document.github_assume.json
}

# Broad but service-scoped (not account-wide "*:*") so the deploy role can
# manage this project's own S3/Lambda/EventBridge/Secrets/CloudWatch/SNS
# resources. Tighten to name-prefixed ARNs before reusing this for a real
# multi-project account.
data "aws_iam_policy_document" "deploy_permissions" {
  statement {
    sid = "ManagePipelineResources"
    actions = [
      "s3:*",
      "lambda:*",
      "events:*",
      "secretsmanager:*",
      "cloudwatch:*",
      "sns:*",
      "logs:*",
      "glue:*",
      "athena:*",
    ]
    resources = ["*"]
  }

  # Terraform state locking (S3 backend + DynamoDB lock table, see
  # state_backend.tf). Scoped to just this table, not "dynamodb:*"/"*".
  statement {
    sid     = "TerraformStateLock"
    actions = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:DescribeTable"]
    resources = [
      "arn:aws:dynamodb:*:${data.aws_caller_identity.current.account_id}:table/${var.project_name}-*",
    ]
  }

  # Bedrock: read-only model discovery + inference only (no fine-tuning,
  # provisioned throughput, or guardrail management -- narrower than the
  # blanket "*:*" pattern used above on purpose, since Bedrock usage is
  # billed per token and worth keeping tightly scoped).
  statement {
    sid = "UseBedrockModels"
    actions = [
      "bedrock:ListFoundationModels",
      "bedrock:GetFoundationModel",
      "bedrock:ListInferenceProfiles",
      "bedrock:GetInferenceProfile",
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
    ]
    resources = ["*"]
  }

  # Bedrock's third-party models (e.g. Anthropic's) are actually provisioned
  # through an AWS Marketplace subscription under the hood -- enabling "model
  # access" in the console isn't enough; the calling identity also needs
  # these to complete that subscription on first use.
  statement {
    sid       = "BedrockMarketplaceSubscription"
    actions   = ["aws-marketplace:ViewSubscriptions", "aws-marketplace:Subscribe"]
    resources = ["*"]
  }

  # IAM role/policy management for this project's own roles -- excludes
  # PassRole, which gets its own tightly scoped statement below.
  statement {
    sid = "ManageProjectIamRolesAndPolicies"
    actions = [
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:GetRole",
      "iam:UpdateRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:PutRolePolicy",
      "iam:GetRolePolicy",
      "iam:DeleteRolePolicy",
      "iam:AttachRolePolicy",
      "iam:DetachRolePolicy",
    ]
    resources = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.project_name}-*"]
  }

  # PassRole is the privilege-escalation-sensitive one: scoped to this
  # project's own role names AND to Lambda only (the one place we pass a
  # role to a service), per the "wildcard action+resource" finding.
  statement {
    sid       = "PassProjectLambdaExecutionRolesOnly"
    actions   = ["iam:PassRole"]
    resources = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.project_name}-*"]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "${var.role_name}-permissions"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.deploy_permissions.json
}

output "role_arn" {
  value = aws_iam_role.github_deploy.arn
}
