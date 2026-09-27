# Daily cross-source keyword-trend detection: trend_scan runs once/day,
# queries github_repos/hackernews_stories/news_articles for the current
# UTC day via common/athena.py's shared query helper, and writes any
# qualifying keywords as Trend Events to the curated zone. See
# docs/superpowers/specs/2026-09-27-trend-events-design.md.

resource "aws_iam_role" "trend_scan_lambda" {
  name               = "${local.name_prefix}-trend-scan-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "trend_scan_basic_logs" {
  role       = aws_iam_role.trend_scan_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "trend_scan_permissions" {
  statement {
    sid       = "RunAthenaQueries"
    actions   = ["athena:StartQueryExecution", "athena:GetQueryExecution", "athena:GetQueryResults"]
    resources = [aws_athena_workgroup.main.arn]
  }

  statement {
    sid     = "ReadGlueCuratedSchema"
    actions = ["glue:GetDatabase", "glue:GetTable", "glue:GetPartitions"]
    resources = [
      "arn:aws:glue:*:${data.aws_caller_identity.current.account_id}:catalog",
      aws_glue_catalog_database.curated.arn,
      "arn:aws:glue:*:${data.aws_caller_identity.current.account_id}:table/${aws_glue_catalog_database.curated.name}/*",
    ]
  }

  statement {
    sid       = "ReadCuratedZone"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.curated.arn}/*"]
  }

  statement {
    sid       = "ListCuratedZone"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.curated.arn]
  }

  statement {
    sid       = "WriteTrendEvents"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.curated.arn}/source=trend_events/*"]
  }

  statement {
    sid       = "WriteAthenaResults"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.curated.arn}/athena-results/*"]
  }

  statement {
    sid       = "AthenaResultsBucketLocation"
    actions   = ["s3:GetBucketLocation"]
    resources = [aws_s3_bucket.curated.arn]
  }
}

resource "aws_iam_role_policy" "trend_scan_permissions" {
  name   = "${local.name_prefix}-trend-scan-permissions"
  role   = aws_iam_role.trend_scan_lambda.id
  policy = data.aws_iam_policy_document.trend_scan_permissions.json
}

data "archive_file" "trend_scan" {
  type        = "zip"
  source_dir  = "${path.module}/build/trend_scan"
  output_path = "${path.module}/build/trend_scan.zip"
}

resource "aws_lambda_function" "trend_scan" {
  function_name    = "${local.name_prefix}-trend-scan"
  role             = aws_iam_role.trend_scan_lambda.arn
  handler          = "trend_scan.lambda_handler"
  runtime          = var.lambda_runtime
  timeout          = 60
  memory_size      = 512
  filename         = data.archive_file.trend_scan.output_path
  source_code_hash = data.archive_file.trend_scan.output_base64sha256
  layers           = [var.pandas_layer_arn]

  environment {
    variables = {
      CURATED_BUCKET           = aws_s3_bucket.curated.bucket
      ATHENA_WORKGROUP         = aws_athena_workgroup.main.name
      ATHENA_DATABASE          = aws_glue_catalog_database.curated.name
      TREND_HN_MIN_STORIES     = tostring(var.trend_hn_min_stories)
      TREND_NEWS_MIN_ARTICLES  = tostring(var.trend_news_min_articles)
      TREND_MAX_EVENTS_PER_DAY = tostring(var.trend_max_events_per_day)
    }
  }
}

resource "aws_cloudwatch_log_group" "trend_scan" {
  name              = "/aws/lambda/${aws_lambda_function.trend_scan.function_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_event_rule" "trend_scan_schedule" {
  name                = "${local.name_prefix}-trend-scan-schedule"
  schedule_expression = var.trend_scan_schedule
  state               = var.enable_ingestion_schedule ? "ENABLED" : "DISABLED"
}

resource "aws_cloudwatch_event_target" "trend_scan" {
  rule = aws_cloudwatch_event_rule.trend_scan_schedule.name
  arn  = aws_lambda_function.trend_scan.arn
}

resource "aws_lambda_permission" "allow_eventbridge_trend_scan" {
  statement_id  = "AllowEventBridgeInvokeTrendScan"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.trend_scan.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.trend_scan_schedule.arn
}
