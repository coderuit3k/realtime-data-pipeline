resource "aws_s3_bucket" "raw" {
  bucket = "${local.name_prefix}-raw-${data.aws_caller_identity.current.account_id}"
  # Lets `terraform destroy` delete a non-empty bucket -- fine for a personal
  # dev/portfolio project where teardown convenience beats accidental-delete
  # protection. Set to false before reusing this for anything that matters.
  force_destroy = true
}

resource "aws_s3_bucket_versioning" "raw" {
  bucket = aws_s3_bucket.raw.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "raw" {
  bucket                  = aws_s3_bucket.raw.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Each ingested object gets a unique key (source/.../{timestamp}-{uuid}.json,
# see common/s3_writer.build_key) and is read once by transform (triggered
# near-instantly via the S3 event notification in s3_notification.tf) --
# nothing ever re-reads a raw object after that. Versioning is on for the
# bucket, so plain `aws s3 rm` would only add delete markers and keep paying
# for the noncurrent version; expiring both here is what actually frees the
# storage. 30 days is a buffer well past normal processing to allow manual
# S3->Athena reprocessing if a transform bug is ever found retroactively.
resource "aws_s3_bucket_lifecycle_configuration" "raw" {
  bucket = aws_s3_bucket.raw.id

  rule {
    id     = "expire-processed-raw-json"
    status = "Enabled"

    filter {}

    expiration {
      days = 30
    }

    noncurrent_version_expiration {
      noncurrent_days = 7
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket" "curated" {
  bucket        = "${local.name_prefix}-curated-${data.aws_caller_identity.current.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_versioning" "curated" {
  bucket = aws_s3_bucket.curated.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "curated" {
  bucket                  = aws_s3_bucket.curated.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
