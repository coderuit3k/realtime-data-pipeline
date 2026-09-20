resource "aws_cloudwatch_event_rule" "ingestion_schedule" {
  name                = "${local.name_prefix}-ingestion-schedule"
  schedule_expression = var.ingestion_schedule
  state               = var.enable_ingestion_schedule ? "ENABLED" : "DISABLED"
}

resource "aws_cloudwatch_event_target" "hackernews_ingestion" {
  rule = aws_cloudwatch_event_rule.ingestion_schedule.name
  arn  = aws_lambda_function.hackernews_ingestion.arn
}

resource "aws_cloudwatch_event_rule" "news_ingestion_schedule" {
  name                = "${local.name_prefix}-news-ingestion-schedule"
  schedule_expression = var.news_ingestion_schedule
  state               = var.enable_ingestion_schedule ? "ENABLED" : "DISABLED"
}

resource "aws_cloudwatch_event_target" "news_ingestion" {
  rule = aws_cloudwatch_event_rule.news_ingestion_schedule.name
  arn  = aws_lambda_function.news_ingestion.arn
}

resource "aws_cloudwatch_event_target" "weather_ingestion" {
  rule = aws_cloudwatch_event_rule.ingestion_schedule.name
  arn  = aws_lambda_function.weather_ingestion.arn
}

resource "aws_lambda_permission" "allow_eventbridge_weather" {
  statement_id  = "AllowEventBridgeInvokeWeather"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.weather_ingestion.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.ingestion_schedule.arn
}

resource "aws_cloudwatch_event_target" "crypto_ingestion" {
  rule = aws_cloudwatch_event_rule.ingestion_schedule.name
  arn  = aws_lambda_function.crypto_ingestion.arn
}

resource "aws_lambda_permission" "allow_eventbridge_crypto" {
  statement_id  = "AllowEventBridgeInvokeCrypto"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.crypto_ingestion.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.ingestion_schedule.arn
}

resource "aws_cloudwatch_event_target" "github_trending_ingestion" {
  rule = aws_cloudwatch_event_rule.ingestion_schedule.name
  arn  = aws_lambda_function.github_trending_ingestion.arn
}

resource "aws_lambda_permission" "allow_eventbridge_github" {
  statement_id  = "AllowEventBridgeInvokeGithub"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.github_trending_ingestion.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.ingestion_schedule.arn
}

resource "aws_lambda_permission" "allow_eventbridge_hackernews" {
  statement_id  = "AllowEventBridgeInvokeHackernews"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.hackernews_ingestion.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.ingestion_schedule.arn
}

resource "aws_lambda_permission" "allow_eventbridge_news" {
  statement_id  = "AllowEventBridgeInvokeNews"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.news_ingestion.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.news_ingestion_schedule.arn
}
