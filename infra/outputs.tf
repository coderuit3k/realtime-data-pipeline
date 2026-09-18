output "raw_bucket_name" {
  value = aws_s3_bucket.raw.bucket
}

output "curated_bucket_name" {
  value = aws_s3_bucket.curated.bucket
}

output "news_secret_name" {
  value = aws_secretsmanager_secret.news_api.name
}

output "tavily_secret_name" {
  value = aws_secretsmanager_secret.tavily_api.name
}

output "hackernews_ingestion_function_name" {
  value = aws_lambda_function.hackernews_ingestion.function_name
}

output "news_ingestion_function_name" {
  value = aws_lambda_function.news_ingestion.function_name
}

output "transform_function_name" {
  value = aws_lambda_function.transform.function_name
}

output "glue_database_name" {
  value = aws_glue_catalog_database.curated.name
}

output "athena_workgroup_name" {
  value = aws_athena_workgroup.main.name
}

output "rag_build_index_function_name" {
  value = aws_lambda_function.rag_build_index.function_name
}

output "rag_query_function_name" {
  value = aws_lambda_function.rag_query.function_name
}
