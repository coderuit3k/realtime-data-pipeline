data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# Ingestion Lambdas: write to raw zone, read their own API credentials.
# (Hacker News needs no credentials -- only the News ingestion Lambda reads a secret.)
resource "aws_iam_role" "ingestion_lambda" {
  name               = "${local.name_prefix}-ingestion-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "ingestion_basic_logs" {
  role       = aws_iam_role.ingestion_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "ingestion_permissions" {
  statement {
    sid       = "WriteRawZone"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.raw.arn}/*"]
  }

  statement {
    sid       = "ReadIngestionSecrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.news_api.arn]
  }
}

resource "aws_iam_role_policy" "ingestion_permissions" {
  name   = "${local.name_prefix}-ingestion-permissions"
  role   = aws_iam_role.ingestion_lambda.id
  policy = data.aws_iam_policy_document.ingestion_permissions.json
}

# Transform Lambda: read raw zone, write curated zone. No secrets access.
resource "aws_iam_role" "transform_lambda" {
  name               = "${local.name_prefix}-transform-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "transform_basic_logs" {
  role       = aws_iam_role.transform_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "transform_permissions" {
  statement {
    sid       = "ReadRawZone"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.raw.arn}/*"]
  }

  statement {
    sid       = "WriteCuratedZone"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.curated.arn}/*"]
  }

  # Keyword extraction now calls Claude Haiku (see transform.py's
  # extract_keywords_llm) instead of only the regex fallback. The account's
  # Bedrock Marketplace subscription for Anthropic models is already
  # established (done once, account-wide) -- no aws-marketplace:Subscribe
  # needed here, just InvokeModel.
  statement {
    sid     = "ExtractKeywordsViaBedrock"
    actions = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    resources = [
      "arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku*",
      "arn:aws:bedrock:*:${data.aws_caller_identity.current.account_id}:inference-profile/*",
    ]
  }
}

resource "aws_iam_role_policy" "transform_permissions" {
  name   = "${local.name_prefix}-transform-permissions"
  role   = aws_iam_role.transform_lambda.id
  policy = data.aws_iam_policy_document.transform_permissions.json
}
