# Classifier labels for each Gmail message (category, urgency, needs_reply, deadline, job_stage,
# company), keyed by message_id. gmail_ingestion re-ingests the newest emails every run, so
# without this cache the transform Lambda would call Bedrock for the same email dozens of times.
# Labels are tiny and stable, so there is no TTL. Only labels are stored, never email text.
resource "aws_dynamodb_table" "gmail_labels" {
  name         = "${local.name_prefix}-gmail-labels"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "message_id"

  attribute {
    name = "message_id"
    type = "S"
  }
}
