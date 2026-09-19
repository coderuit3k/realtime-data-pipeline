resource "aws_iam_user" "web_app" {
  name = "${local.name_prefix}-web-app"
}

resource "aws_iam_user_policy" "web_app" {
  name = "${local.name_prefix}-web-app-policy"
  user = aws_iam_user.web_app.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AthenaQuery"
        Effect = "Allow"
        Action = [
          "athena:StartQueryExecution",
          "athena:GetQueryExecution",
          "athena:GetQueryResults",
          "athena:StopQueryExecution",
          "athena:GetWorkGroup",
        ]
        Resource = aws_athena_workgroup.main.arn
      },
      {
        Sid    = "GlueReadCuratedDatabase"
        Effect = "Allow"
        Action = ["glue:GetTable", "glue:GetDatabase", "glue:GetPartitions"]
        Resource = [
          "arn:aws:glue:${var.aws_region}:${data.aws_caller_identity.current.account_id}:catalog",
          "arn:aws:glue:${var.aws_region}:${data.aws_caller_identity.current.account_id}:database/${aws_glue_catalog_database.curated.name}",
          "arn:aws:glue:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/${aws_glue_catalog_database.curated.name}/*",
        ]
      },
      {
        Sid      = "S3ReadCuratedData"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:ListBucket", "s3:GetBucketLocation"]
        Resource = [aws_s3_bucket.curated.arn, "${aws_s3_bucket.curated.arn}/*"]
      },
      {
        Sid      = "S3AthenaResults"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = "${aws_s3_bucket.curated.arn}/athena-results/*"
      },
      {
        Sid      = "CloudWatchAlarmsReadOnly"
        Effect   = "Allow"
        Action   = ["cloudwatch:DescribeAlarms"]
        Resource = "*"
      },
      {
        Sid      = "InvokeRagLambdas"
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = [aws_lambda_function.rag_query.arn, aws_lambda_function.rag_agent.arn]
      },
    ]
  })
}

resource "aws_iam_access_key" "web_app" {
  user = aws_iam_user.web_app.name
}
