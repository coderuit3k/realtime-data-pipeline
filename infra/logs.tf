# Lambda auto-creates its log group on first invoke with NO retention limit
# (logs pile up forever). Pre-creating these with a retention window bounds
# that cost -- Lambda just writes into the existing group instead of making
# its own.
resource "aws_cloudwatch_log_group" "hackernews_ingestion" {
  name              = "/aws/lambda/${aws_lambda_function.hackernews_ingestion.function_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "news_ingestion" {
  name              = "/aws/lambda/${aws_lambda_function.news_ingestion.function_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "weather_ingestion" {
  name              = "/aws/lambda/${aws_lambda_function.weather_ingestion.function_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "crypto_ingestion" {
  name              = "/aws/lambda/${aws_lambda_function.crypto_ingestion.function_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "transform" {
  name              = "/aws/lambda/${aws_lambda_function.transform.function_name}"
  retention_in_days = var.log_retention_days
}
