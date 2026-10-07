# Aggregates the Gmail labels (counts and dates only, no email text) into one JSON object in the
# curated bucket under gmail_stats/. The public web app reads that object; it never queries the
# Gmail Glue database. The Lambda runs Athena against the Gmail database (ATHENA_DATABASE).
# See docs/superpowers/specs/2026-10-06-gmail-email-intelligence-design.md.

resource "aws_iam_role" "gmail_stats_lambda" {
  name               = "${local.name_prefix}-gmail-stats-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "gmail_stats_basic_logs" {
  role       = aws_iam_role.gmail_stats_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "gmail_stats_permissions" {
  statement {
    sid       = "RunAthenaQueries"
    actions   = ["athena:StartQueryExecution", "athena:GetQueryExecution", "athena:GetQueryResults"]
    resources = [aws_athena_workgroup.main.arn]
  }

  statement {
    sid     = "ReadGlueGmailSchema"
    actions = ["glue:GetDatabase", "glue:GetTable", "glue:GetPartitions"]
    resources = [
      "arn:aws:glue:*:${data.aws_caller_identity.current.account_id}:catalog",
      aws_glue_catalog_database.gmail.arn,
      "arn:aws:glue:*:${data.aws_caller_identity.current.account_id}:table/${aws_glue_catalog_database.gmail.name}/*",
    ]
  }

  statement {
    sid       = "ReadCuratedZone"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.curated.arn}/*"]
  }

  statement {
    sid       = "ListCuratedZone"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.curated.arn]
  }

  statement {
    sid       = "WriteGmailStats"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.curated.arn}/gmail_stats/*"]
  }

  statement {
    sid       = "WriteAthenaResults"
    actions   = ["s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.curated.arn}/athena-results/*"]
  }
}

resource "aws_iam_role_policy" "gmail_stats_permissions" {
  name   = "${local.name_prefix}-gmail-stats-permissions"
  role   = aws_iam_role.gmail_stats_lambda.id
  policy = data.aws_iam_policy_document.gmail_stats_permissions.json
}

data "archive_file" "gmail_stats" {
  type        = "zip"
  source_dir  = "${path.module}/build/gmail_stats"
  output_path = "${path.module}/build/gmail_stats.zip"
}

resource "aws_lambda_function" "gmail_stats" {
  function_name    = "${local.name_prefix}-gmail-stats"
  role             = aws_iam_role.gmail_stats_lambda.arn
  handler          = "gmail_stats.lambda_handler"
  runtime          = var.lambda_runtime
  timeout          = 60
  memory_size      = 256
  filename         = data.archive_file.gmail_stats.output_path
  source_code_hash = data.archive_file.gmail_stats.output_base64sha256

  environment {
    variables = {
      CURATED_BUCKET   = aws_s3_bucket.curated.bucket
      ATHENA_WORKGROUP = aws_athena_workgroup.main.name
      ATHENA_DATABASE  = aws_glue_catalog_database.gmail.name
    }
  }
}

resource "aws_cloudwatch_log_group" "gmail_stats" {
  name              = "/aws/lambda/${aws_lambda_function.gmail_stats.function_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_event_rule" "gmail_stats_schedule" {
  name                = "${local.name_prefix}-gmail-stats-schedule"
  schedule_expression = var.gmail_stats_schedule
  state               = var.enable_ingestion_schedule ? "ENABLED" : "DISABLED"
}

resource "aws_cloudwatch_event_target" "gmail_stats" {
  rule = aws_cloudwatch_event_rule.gmail_stats_schedule.name
  arn  = aws_lambda_function.gmail_stats.arn
}

resource "aws_lambda_permission" "allow_eventbridge_gmail_stats" {
  statement_id  = "AllowEventBridgeInvokeGmailStats"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.gmail_stats.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.gmail_stats_schedule.arn
}
