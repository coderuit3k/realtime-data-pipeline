# Serverless Agentic RAG over the curated zone: build_index embeds every
# curated record via Bedrock Titan and writes a JSON index to S3 (now also on
# a nightly EventBridge schedule, see rag_build_index_schedule below -- still
# cache-aware via build_index.py's model_id-keyed cache, so a nightly run only
# re-embeds genuinely new/changed documents, not the whole curated zone);
# agent (on-demand only, unchanged) is a Bedrock Converse tool-calling loop
# that decides for itself whether/when to query that index
# (search_knowledge_base) or fall back to a real web search (search_web,
# Tavily). Still no vector database (e.g. OpenSearch Serverless) -- that
# would run 24/7 and cost real money even idle; at this dataset's size,
# Lambda-memory cosine search is plenty and costs $0 outside a run.

# Question/answer cache for rag_agent: a repeated question is served straight
# from here instead of re-running the Bedrock tool-calling loop. On-demand
# billing (pay per request, $0 idle) plus TTL make this cheaper than any
# always-on cache -- see the DynamoDB-vs-Redis/Supabase cost comparison this
# replaced (Redis/ElastiCache has a real monthly floor even serverless;
# Supabase's free tier pauses after a week of inactivity, and its paid tier
# alone costs more than this project's entire current AWS bill).
resource "aws_dynamodb_table" "rag_memory" {
  name         = "${local.name_prefix}-rag-memory"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "question_hash"

  attribute {
    name = "question_hash"
    type = "S"
  }

  # Short-term entries (a question asked fewer than
  # RAG_MEMORY_PROMOTE_AFTER_HITS times) carry a `ttl` and expire
  # automatically. Long-term (promoted) entries omit `ttl` and are never
  # expired by DynamoDB -- see rag/agent.py store_cached_answer.
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
}

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

  # query_athena tool: same workgroup/database the public Data Explorer page
  # queries (infra/glue.tf) -- scoped to the "curated" Glue database only, the
  # gmail database stays excluded, same boundary the Explorer page enforces.
  statement {
    sid       = "RunAthenaQueries"
    actions   = ["athena:StartQueryExecution", "athena:GetQueryExecution", "athena:GetQueryResults"]
    resources = [aws_athena_workgroup.main.arn]
  }

  statement {
    sid = "ReadGlueCuratedSchema"
    # GetPartitions is likely unused in practice -- all curated tables use
    # partition projection (infra/glue.tf), so Athena computes partition
    # locations itself without calling Glue for them. Kept for defense in
    # depth (e.g. a future non-projected table) since it's scoped to the
    # curated database only either way.
    actions = ["glue:GetDatabase", "glue:GetTable", "glue:GetPartitions"]
    resources = [
      "arn:aws:glue:*:${data.aws_caller_identity.current.account_id}:catalog",
      aws_glue_catalog_database.curated.arn,
      "arn:aws:glue:*:${data.aws_caller_identity.current.account_id}:table/${aws_glue_catalog_database.curated.name}/*",
    ]
  }

  # Athena writes query results to S3 as the calling principal, not its own
  # service role -- GetObject/ListBucket on the curated bucket are already
  # granted above, this adds the write + bucket-location calls Athena needs.
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

  statement {
    sid       = "ReadWriteRagMemory"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem"]
    resources = [aws_dynamodb_table.rag_memory.arn]
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

resource "aws_cloudwatch_event_rule" "rag_build_index_schedule" {
  name                = "${local.name_prefix}-rag-build-index-schedule"
  schedule_expression = var.rag_build_index_schedule
  state               = var.enable_ingestion_schedule ? "ENABLED" : "DISABLED"
}

resource "aws_cloudwatch_event_target" "rag_build_index" {
  rule = aws_cloudwatch_event_rule.rag_build_index_schedule.name
  arn  = aws_lambda_function.rag_build_index.arn
  # build_index.lambda_handler ignores its event payload entirely (it always
  # rescans the whole curated zone and diffs against the cache) -- no input
  # needed here, unlike rag_agent which requires {"question": ...}.
}

resource "aws_lambda_permission" "allow_eventbridge_rag_build_index" {
  statement_id  = "AllowEventBridgeInvokeRagBuildIndex"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.rag_build_index.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.rag_build_index_schedule.arn
}

resource "aws_lambda_function" "rag_agent" {
  function_name = "${local.name_prefix}-rag-agent"
  role          = aws_iam_role.rag_lambda.arn
  handler       = "agent.lambda_handler"
  runtime       = var.lambda_runtime
  # 90s was enough headroom for the original 4 tools; query_athena adds a
  # worst-case ~20s blocking poll per call (see ATHENA_MAX_POLL_ATTEMPTS *
  # ATHENA_POLL_INTERVAL_SECONDS in common/athena.py), and MAX_ITERATIONS (6)
  # means it can be called more than once in a single request -- bumped for
  # that tail latency, not because this project's own tiny datasets are
  # actually slow to query.
  timeout          = 180
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
      ATHENA_WORKGROUP       = aws_athena_workgroup.main.name
      ATHENA_DATABASE        = aws_glue_catalog_database.curated.name
      RAG_MEMORY_TABLE       = aws_dynamodb_table.rag_memory.name
    }
  }
}

resource "aws_cloudwatch_log_group" "rag_agent" {
  name              = "/aws/lambda/${aws_lambda_function.rag_agent.function_name}"
  retention_in_days = var.log_retention_days
}
