resource "aws_sns_topic" "alerts" {
  count = var.alarm_email != "" ? 1 : 0
  name  = "${local.name_prefix}-alerts"
}

resource "aws_sns_topic_subscription" "alerts_email" {
  count     = var.alarm_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.alerts[0].arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

locals {
  alarm_actions = var.alarm_email != "" ? [aws_sns_topic.alerts[0].arn] : []
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each = {
    hackernews_ingestion      = aws_lambda_function.hackernews_ingestion.function_name
    news_ingestion            = aws_lambda_function.news_ingestion.function_name
    weather_ingestion         = aws_lambda_function.weather_ingestion.function_name
    crypto_ingestion          = aws_lambda_function.crypto_ingestion.function_name
    github_trending_ingestion = aws_lambda_function.github_trending_ingestion.function_name
    gmail_ingestion           = aws_lambda_function.gmail_ingestion.function_name
    transform                 = aws_lambda_function.transform.function_name
  }

  alarm_name          = "${local.name_prefix}-${each.key}-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    FunctionName = each.value
  }
}

# Data-quality anomalies (zero output from a nonzero batch, or an abnormally
# high duplicate-collapse rate -- see transform.detect_data_quality_issues)
# are logged as a warning, not raised as an exception, so the generic Errors
# alarm above can't see them. A metric produced by a log metric filter is
# still a custom metric for billing purposes (same $0.30/metric-month past
# the free tier as one written via put_metric_data) -- this is free right
# now only because it's this account's first custom metric, within
# CloudWatch's Always-Free 10-custom-metric/10-alarm allowance. Adding
# several more filter-derived metrics would eventually cost the same as
# put_metric_data would; it doesn't make metric filters inherently exempt.
resource "aws_cloudwatch_log_metric_filter" "transform_data_quality" {
  name           = "${local.name_prefix}-transform-data-quality"
  log_group_name = aws_cloudwatch_log_group.transform.name
  pattern        = "\"DATA_QUALITY_ALERT\""

  metric_transformation {
    name          = "DataQualityAlerts"
    namespace     = "${local.name_prefix}/DataQuality"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "transform_data_quality" {
  alarm_name          = "${local.name_prefix}-transform-data-quality"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = aws_cloudwatch_log_metric_filter.transform_data_quality.metric_transformation[0].name
  namespace           = aws_cloudwatch_log_metric_filter.transform_data_quality.metric_transformation[0].namespace
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}
