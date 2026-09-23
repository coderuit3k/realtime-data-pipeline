# Serverless Agentic RAG over the curated zone: build_index (on-demand) embeds
# every curated record via Bedrock Titan and writes a JSON index to S3; agent
# (on-demand) is a Bedrock Converse tool-calling loop that decides for itself
# whether/when to query that index (search_knowledge_base) or fall back to a
# real web search (search_web, Tavily). No EventBridge schedule and no vector
# database (e.g. OpenSearch Serverless) -- both would run 24/7 and cost real
# money even idle. At this dataset's size, Lambda-memory cosine search is
# plenty and costs $0 when not invoked.

resource "aws_iam_role" "rag_lambda" {
  name               = "${local.name_prefix}-rag-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "rag_basic_logs" {
  role       = aws_iam_role.rag_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "rag_permissions" {
  statement {
    sid       = "ReadCuratedZone"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.curated.arn}/*"]
  }

  # s3:ListBucket is a bucket-level permission (resource = the bucket ARN
  # itself, not "/*") -- separate from GetObject above, needed for
  # list_objects_v2 to discover the curated Parquet files' keys.
  statement {
    sid       = "ListCuratedZone"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.curated.arn]
  }

  statement {
    sid       = "WriteRagIndex"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.curated.arn}/rag-index/*"]
  }

  # Scoped to the two specific model families this project uses, not a
  # blanket "bedrock:*" resource wildcard -- Bedrock is billed per token.
  statement {
    sid     = "InvokeBedrockModels"
    actions = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    resources = [
      "arn:aws:bedrock:*::foundation-model/${var.bedrock_embed_model_id}",
      "arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku*",
      "arn:aws:bedrock:*:${data.aws_caller_identity.current.account_id}:inference-profile/*",
    ]
  }

  # Anthropic's models on Bedrock are provisioned via an AWS Marketplace
  # subscription under the hood -- the calling identity needs this too,
  # not just whoever enabled "model access" in the console.
  statement {
    sid       = "BedrockMarketplaceSubscription"
    actions   = ["aws-marketplace:ViewSubscriptions", "aws-marketplace:Subscribe"]
    resources = ["*"]
  }

  statement {
    sid       = "ReadTavilySecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.tavily_api.arn]
  }
}

resource "aws_iam_role_policy" "rag_permissions" {
  name   = "${local.name_prefix}-rag-permissions"
  role   = aws_iam_role.rag_lambda.id
  policy = data.aws_iam_policy_document.rag_permissions.json
}

data "archive_file" "rag_build_index" {
  type        = "zip"
  source_dir  = "${path.module}/build/rag_build_index"
  output_path = "${path.module}/build/rag_build_index.zip"
}

data "archive_file" "rag_agent" {
  type        = "zip"
  source_dir  = "${path.module}/build/rag_agent"
  output_path = "${path.module}/build/rag_agent.zip"
}

resource "aws_lambda_function" "rag_build_index" {
  function_name    = "${local.name_prefix}-rag-build-index"
  role             = aws_iam_role.rag_lambda.arn
  handler          = "build_index.lambda_handler"
  runtime          = var.lambda_runtime
  timeout          = 300
  memory_size      = 512
  filename         = data.archive_file.rag_build_index.output_path
  source_code_hash = data.archive_file.rag_build_index.output_base64sha256
  layers           = [var.pandas_layer_arn] # provides pandas/pyarrow/numpy/boto3

  environment {
    variables = {
      CURATED_BUCKET         = aws_s3_bucket.curated.bucket
      BEDROCK_EMBED_MODEL_ID = var.bedrock_embed_model_id
    }
  }
}

resource "aws_cloudwatch_log_group" "rag_build_index" {
  name              = "/aws/lambda/${aws_lambda_function.rag_build_index.function_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "rag_agent" {
  function_name    = "${local.name_prefix}-rag-agent"
  role             = aws_iam_role.rag_lambda.arn
  handler          = "agent.lambda_handler"
  runtime          = var.lambda_runtime
  timeout          = 90
  memory_size      = 512
  filename         = data.archive_file.rag_agent.output_path
  source_code_hash = data.archive_file.rag_agent.output_base64sha256
  layers           = [var.pandas_layer_arn]

  environment {
    variables = {
      CURATED_BUCKET         = aws_s3_bucket.curated.bucket
      BEDROCK_EMBED_MODEL_ID = var.bedrock_embed_model_id
      BEDROCK_TEXT_MODEL_ID  = var.bedrock_text_model_id
      RAG_TOP_K              = tostring(var.rag_top_k)
      TAVILY_SECRET_NAME     = aws_secretsmanager_secret.tavily_api.name
    }
  }
}

resource "aws_cloudwatch_log_group" "rag_agent" {
  name              = "/aws/lambda/${aws_lambda_function.rag_agent.function_name}"
  retention_in_days = var.log_retention_days
}
