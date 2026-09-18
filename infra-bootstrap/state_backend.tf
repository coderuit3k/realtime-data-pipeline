# Remote state for infra/ -- so both local runs and GitHub Actions CI/CD
# operate against the SAME state. Without this, CI would start from an
# empty local state and try to recreate everything that already exists.
# Lives in infra-bootstrap (not infra/) to break the chicken-and-egg problem:
# infra/ can't create the bucket that holds its own state.

resource "aws_s3_bucket" "tfstate" {
  bucket = "${var.project_name}-tfstate-${data.aws_caller_identity.current.account_id}"
  # Deliberately no force_destroy -- this is state, not disposable data.
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_dynamodb_table" "tflock" {
  name         = "${var.project_name}-tfstate-lock"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}

output "tfstate_bucket_name" {
  value = aws_s3_bucket.tfstate.bucket
}

output "tfstate_lock_table_name" {
  value = aws_dynamodb_table.tflock.name
}
