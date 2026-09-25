# Zips are built by ../scripts/build_lambdas.sh, which must run before `terraform apply`
# (see infra/README.md). Terraform only re-packages what that script already staged.

data "archive_file" "hackernews_ingestion" {
  type        = "zip"
  source_dir  = "${path.module}/build/hackernews_ingestion"
  output_path = "${path.module}/build/hackernews_ingestion.zip"
}

data "archive_file" "news_ingestion" {
  type        = "zip"
  source_dir  = "${path.module}/build/news_ingestion"
  output_path = "${path.module}/build/news_ingestion.zip"
}

data "archive_file" "weather_ingestion" {
  type        = "zip"
  source_dir  = "${path.module}/build/weather_ingestion"
  output_path = "${path.module}/build/weather_ingestion.zip"
}

data "archive_file" "crypto_ingestion" {
  type        = "zip"
  source_dir  = "${path.module}/build/crypto_ingestion"
  output_path = "${path.module}/build/crypto_ingestion.zip"
}

data "archive_file" "github_trending_ingestion" {
  type        = "zip"
  source_dir  = "${path.module}/build/github_trending_ingestion"
  output_path = "${path.module}/build/github_trending_ingestion.zip"
}

data "archive_file" "gmail_ingestion" {
  type        = "zip"
  source_dir  = "${path.module}/build/gmail_ingestion"
  output_path = "${path.module}/build/gmail_ingestion.zip"
}

data "archive_file" "transform" {
  type        = "zip"
  source_dir  = "${path.module}/build/transform"
  output_path = "${path.module}/build/transform.zip"
}

resource "aws_lambda_function" "hackernews_ingestion" {
  function_name    = "${local.name_prefix}-hackernews-ingestion"
  role             = aws_iam_role.ingestion_lambda.arn
  handler          = "hackernews_ingestion.lambda_handler"
  runtime          = var.lambda_runtime
  timeout          = 60
  memory_size      = 256
  filename         = data.archive_file.hackernews_ingestion.output_path
  source_code_hash = data.archive_file.hackernews_ingestion.output_base64sha256

  environment {
    variables = {
      RAW_BUCKET     = aws_s3_bucket.raw.bucket
      HN_FEED        = var.hn_feed
      HN_STORY_LIMIT = tostring(var.hn_story_limit)
    }
  }
}

resource "aws_lambda_function" "news_ingestion" {
  function_name    = "${local.name_prefix}-news-ingestion"
  role             = aws_iam_role.ingestion_lambda.arn
  handler          = "news_ingestion.lambda_handler"
  runtime          = var.lambda_runtime
  timeout          = 60
  memory_size      = 256
  filename         = data.archive_file.news_ingestion.output_path
  source_code_hash = data.archive_file.news_ingestion.output_base64sha256

  environment {
    variables = {
      RAW_BUCKET       = aws_s3_bucket.raw.bucket
      NEWS_SECRET_NAME = aws_secretsmanager_secret.news_api.name
      NEWS_QUERY       = var.news_query
    }
  }
}

resource "aws_lambda_function" "weather_ingestion" {
  function_name    = "${local.name_prefix}-weather-ingestion"
  role             = aws_iam_role.ingestion_lambda.arn
  handler          = "weather_ingestion.lambda_handler"
  runtime          = var.lambda_runtime
  timeout          = 60
  memory_size      = 256
  filename         = data.archive_file.weather_ingestion.output_path
  source_code_hash = data.archive_file.weather_ingestion.output_base64sha256

  environment {
    variables = {
      RAW_BUCKET = aws_s3_bucket.raw.bucket
    }
  }
}

resource "aws_lambda_function" "crypto_ingestion" {
  function_name    = "${local.name_prefix}-crypto-ingestion"
  role             = aws_iam_role.ingestion_lambda.arn
  handler          = "crypto_ingestion.lambda_handler"
  runtime          = var.lambda_runtime
  timeout          = 60
  memory_size      = 256
  filename         = data.archive_file.crypto_ingestion.output_path
  source_code_hash = data.archive_file.crypto_ingestion.output_base64sha256

  environment {
    variables = {
      RAW_BUCKET = aws_s3_bucket.raw.bucket
    }
  }
}

resource "aws_lambda_function" "github_trending_ingestion" {
  function_name    = "${local.name_prefix}-github-trending-ingestion"
  role             = aws_iam_role.ingestion_lambda.arn
  handler          = "github_trending_ingestion.lambda_handler"
  runtime          = var.lambda_runtime
  timeout          = 60
  memory_size      = 256
  filename         = data.archive_file.github_trending_ingestion.output_path
  source_code_hash = data.archive_file.github_trending_ingestion.output_base64sha256

  environment {
    variables = {
      RAW_BUCKET            = aws_s3_bucket.raw.bucket
      GITHUB_TRENDING_DAYS  = tostring(var.github_trending_days)
      GITHUB_TRENDING_LIMIT = tostring(var.github_trending_limit)
    }
  }
}

resource "aws_lambda_function" "gmail_ingestion" {
  function_name    = "${local.name_prefix}-gmail-ingestion"
  role             = aws_iam_role.ingestion_lambda.arn
  handler          = "gmail_ingestion.lambda_handler"
  runtime          = var.lambda_runtime
  timeout          = 60
  memory_size      = 1024
  filename         = data.archive_file.gmail_ingestion.output_path
  source_code_hash = data.archive_file.gmail_ingestion.output_base64sha256

  environment {
    variables = {
      RAW_BUCKET           = aws_s3_bucket.raw.bucket
      GMAIL_SECRET_NAME    = aws_secretsmanager_secret.gmail_ingestion.name
      GMAIL_R2_BUCKET_NAME = var.gmail_r2_bucket_name
      GMAIL_MESSAGE_LIMIT  = tostring(var.gmail_message_limit)
    }
  }
}

resource "aws_lambda_function" "transform" {
  function_name    = "${local.name_prefix}-transform"
  role             = aws_iam_role.transform_lambda.arn
  handler          = "transform.lambda_handler"
  runtime          = var.lambda_runtime
  timeout          = 120
  memory_size      = 512
  filename         = data.archive_file.transform.output_path
  source_code_hash = data.archive_file.transform.output_base64sha256
  layers           = [var.pandas_layer_arn]

  environment {
    variables = {
      CURATED_BUCKET        = aws_s3_bucket.curated.bucket
      BEDROCK_TEXT_MODEL_ID = var.bedrock_text_model_id
    }
  }
}
