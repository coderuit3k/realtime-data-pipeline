# Glue Catalog + Athena over the curated zone. Uses partition projection
# (Athena computes partition locations from the templates below) instead of
# a crawler or MSCK REPAIR TABLE -- queries work immediately after apply,
# with no extra step to discover the year=/month=/day= partitions.

resource "aws_glue_catalog_database" "curated" {
  name = "${replace(local.name_prefix, "-", "_")}_curated"
}

# Separate from the "curated" database (which the public web app's IAM
# policy grants read access to via /api/explorer/query) -- gmail_messages
# holds real private email content (subject, from_address, snippet) and
# must never be queryable through that public, unauthenticated page.
resource "aws_glue_catalog_database" "gmail" {
  name = "${replace(local.name_prefix, "-", "_")}_gmail"
}

locals {
  hackernews_columns = [
    { name = "story_id", type = "string", comment = "Hacker News item id (Firebase API item.id), unique per story." },
    { name = "source", type = "string", comment = "Constant \"hackernews\" -- identifies which ingestion pipeline produced this row." },
    { name = "title", type = "string", comment = "Story title as posted. Stored normalized: lowercase, no punctuation or stopwords." },
    { name = "text", type = "string", comment = "Self-post body text (Ask HN / Show HN); empty for link posts. Stored normalized: lowercase, no punctuation or stopwords." },
    { name = "author", type = "string", comment = "Hacker News username of the story submitter." },
    { name = "score", type = "bigint", comment = "Upvote score at the time this record was ingested." },
    { name = "num_comments", type = "bigint", comment = "Comment count (item.descendants) at the time this record was ingested." },
    { name = "url", type = "string", comment = "External link the story points to; empty for text-only self-posts." },
    { name = "permalink", type = "string", comment = "Hacker News discussion page URL (news.ycombinator.com/item?id=...)." },
    { name = "created_at", type = "string", comment = "Story submission time, ISO 8601 UTC, converted from the API's Unix timestamp." },
    { name = "ingested_at", type = "string", comment = "Time this record was fetched by the ingestion Lambda, ISO 8601 UTC." },
    { name = "keywords", type = "string", comment = "Comma-separated topical keywords extracted from title/text by the transform step (LLM via Bedrock, falls back to regex on failure)." },
  ]

  news_columns = [
    { name = "article_id", type = "string", comment = "Article's source URL, used as its unique id (NewsAPI has no separate article id)." },
    { name = "source", type = "string", comment = "Constant \"news\" -- identifies which ingestion pipeline produced this row." },
    { name = "provider", type = "string", comment = "Name of the publishing outlet (NewsAPI's source.name), e.g. \"BBC News\"." },
    { name = "title", type = "string", comment = "Article headline. Stored normalized: lowercase, no punctuation or stopwords." },
    { name = "description", type = "string", comment = "Short article summary/dek as returned by NewsAPI. Stored normalized: lowercase, no punctuation or stopwords." },
    { name = "url", type = "string", comment = "Link to the full article on the publisher's site." },
    { name = "published_at", type = "string", comment = "Publish time as reported by NewsAPI (publisher-supplied, not independently verified)." },
    { name = "ingested_at", type = "string", comment = "Time this record was fetched by the ingestion Lambda, ISO 8601 UTC." },
    { name = "keywords", type = "string", comment = "Comma-separated topical keywords extracted from title/description by the transform step (LLM via Bedrock, falls back to regex on failure)." },
    { name = "image_url", type = "string", comment = "Article thumbnail (NewsAPI's urlToImage), empty string when NewsAPI didn't provide one. Rows ingested before this column existed read back NULL, not empty string." },
  ]

  weather_columns = [
    { name = "weather_id", type = "string", comment = "Synthetic id \"{location}-{observed_at}\", unique per location per observation timestamp." },
    { name = "source", type = "string", comment = "Constant \"weather\" -- identifies which ingestion pipeline produced this row." },
    { name = "location", type = "string", comment = "Human-readable place name from the fixed WEATHER_LOCATIONS list in common/config.py." },
    { name = "latitude", type = "double", comment = "Observation point latitude, decimal degrees." },
    { name = "longitude", type = "double", comment = "Observation point longitude, decimal degrees." },
    { name = "temperature_c", type = "double", comment = "Air temperature at 2m, degrees Celsius (Open-Meteo current.temperature_2m)." },
    { name = "humidity_pct", type = "double", comment = "Relative humidity at 2m, percent (0-100)." },
    { name = "precipitation_mm", type = "double", comment = "Precipitation over the last hour, millimeters." },
    { name = "weather_code", type = "bigint", comment = "Open-Meteo WMO weather code; see Open-Meteo's docs for the code table." },
    { name = "wind_speed_kmh", type = "double", comment = "Wind speed at 10m, km/h." },
    { name = "observed_at", type = "string", comment = "Timestamp of the observation, ISO 8601, as reported by Open-Meteo." },
    { name = "ingested_at", type = "string", comment = "Time this record was fetched by the ingestion Lambda, ISO 8601 UTC." },
    { name = "keywords", type = "string", comment = "Always empty for this source -- keyword extraction doesn't apply to structured weather data; kept only so all curated tables share the same column set." },
  ]

  crypto_columns = [
    { name = "price_id", type = "string", comment = "Synthetic id \"{coin_id}-{last_updated_at}\", unique per coin per price update." },
    { name = "source", type = "string", comment = "Constant \"crypto\" -- identifies which ingestion pipeline produced this row." },
    { name = "coin_id", type = "string", comment = "CoinGecko coin id (e.g. \"bitcoin\", \"ethereum\", \"solana\") -- CoinGecko's own naming, not the ticker symbol." },
    { name = "price_usd", type = "double", comment = "Current spot price in USD." },
    { name = "market_cap_usd", type = "double", comment = "Market capitalization in USD." },
    { name = "volume_24h_usd", type = "double", comment = "Trading volume over the trailing 24 hours, in USD." },
    { name = "change_24h_pct", type = "double", comment = "Price change over the trailing 24 hours, percent." },
    { name = "observed_at", type = "string", comment = "Timestamp CoinGecko last updated this price, converted to ISO 8601 UTC." },
    { name = "ingested_at", type = "string", comment = "Time this record was fetched by the ingestion Lambda, ISO 8601 UTC." },
    { name = "keywords", type = "string", comment = "Always empty for this source -- keyword extraction doesn't apply to structured price data; kept only so all curated tables share the same column set." },
  ]

  github_columns = [
    { name = "repo_id", type = "string", comment = "GitHub repository numeric id." },
    { name = "source", type = "string", comment = "Constant \"github\" -- identifies which ingestion pipeline produced this row." },
    { name = "full_name", type = "string", comment = "Repository's \"owner/repo\" identifier." },
    { name = "description", type = "string", comment = "Repository description as set by the owner. Stored normalized: lowercase, no punctuation or stopwords." },
    { name = "url", type = "string", comment = "Repository's GitHub page URL." },
    { name = "language", type = "string", comment = "Primary programming language GitHub detected for the repo." },
    { name = "stars", type = "bigint", comment = "Star count at the time this record was ingested." },
    { name = "forks", type = "bigint", comment = "Fork count at the time this record was ingested." },
    { name = "created_at", type = "string", comment = "Repository creation timestamp, ISO 8601, as reported by GitHub." },
    { name = "pushed_at", type = "string", comment = "Timestamp of the most recent push to the repo, ISO 8601, as reported by GitHub." },
    { name = "ingested_at", type = "string", comment = "Time this record was fetched by the ingestion Lambda, ISO 8601 UTC." },
    { name = "keywords", type = "string", comment = "Comma-separated topical keywords extracted from description by the transform step (LLM via Bedrock, falls back to regex on failure)." },
    { name = "avatar_url", type = "string", comment = "Repository owner's GitHub avatar image URL, empty string if GitHub didn't return an owner. Rows ingested before this column existed read back NULL, not empty string." },
  ]

  gmail_columns = [
    { name = "message_id", type = "string", comment = "Gmail message id (Gmail API's message.id), unique per email." },
    { name = "source", type = "string", comment = "Constant \"gmail\" -- identifies which ingestion pipeline produced this row." },
    { name = "subject", type = "string", comment = "Email subject line, with RFC 2047 encoded-word headers decoded." },
    { name = "from_address", type = "string", comment = "Raw From header (display name + address), with RFC 2047 encoded-word headers decoded." },
    { name = "snippet", type = "string", comment = "First 200 characters of the plain-text body, for preview only -- the full raw message is archived separately in Cloudflare R2 (see infra/README.md), not stored here." },
    { name = "received_at", type = "string", comment = "Time Gmail recorded receiving the message (internalDate), ISO 8601 UTC." },
    { name = "ingested_at", type = "string", comment = "Time this record was fetched by the ingestion Lambda, ISO 8601 UTC." },
    { name = "keywords", type = "string", comment = "Comma-separated topical keywords extracted from subject/snippet by the transform step (LLM via Bedrock, falls back to regex on failure)." },
  ]

  # Shared partition projection config -- only the source-specific location
  # template differs between the two tables.
  partition_projection_base = {
    "projection.enabled"      = "true"
    "projection.year.type"    = "integer"
    "projection.year.range"   = "2024,2035"
    "projection.month.type"   = "integer"
    "projection.month.range"  = "1,12"
    "projection.month.digits" = "2"
    "projection.day.type"     = "integer"
    "projection.day.range"    = "1,31"
    "projection.day.digits"   = "2"
  }
}

resource "aws_glue_catalog_table" "hackernews_stories" {
  name          = "hackernews_stories"
  database_name = aws_glue_catalog_database.curated.name
  table_type    = "EXTERNAL_TABLE"

  parameters = merge(local.partition_projection_base, {
    "classification"            = "parquet"
    "storage.location.template" = "s3://${aws_s3_bucket.curated.bucket}/source=hackernews/year=$${year}/month=$${month}/day=$${day}/"
  })

  partition_keys {
    name    = "year"
    type    = "string"
    comment = "Partition key, derived from the S3 key path (year=YYYY) via Athena partition projection -- not a column stored in the file itself."
  }
  partition_keys {
    name    = "month"
    type    = "string"
    comment = "Partition key, derived from the S3 key path (month=MM, zero-padded) via Athena partition projection -- not a column stored in the file itself."
  }
  partition_keys {
    name    = "day"
    type    = "string"
    comment = "Partition key, derived from the S3 key path (day=DD, zero-padded) via Athena partition projection -- not a column stored in the file itself."
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.curated.bucket}/source=hackernews/"
    input_format  = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat"

    ser_de_info {
      serialization_library = "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe"
    }

    dynamic "columns" {
      for_each = local.hackernews_columns
      content {
        name    = columns.value.name
        type    = columns.value.type
        comment = columns.value.comment
      }
    }
  }
}

resource "aws_glue_catalog_table" "news_articles" {
  name          = "news_articles"
  database_name = aws_glue_catalog_database.curated.name
  table_type    = "EXTERNAL_TABLE"

  parameters = merge(local.partition_projection_base, {
    "classification"            = "parquet"
    "storage.location.template" = "s3://${aws_s3_bucket.curated.bucket}/source=news/year=$${year}/month=$${month}/day=$${day}/"
  })

  partition_keys {
    name    = "year"
    type    = "string"
    comment = "Partition key, derived from the S3 key path (year=YYYY) via Athena partition projection -- not a column stored in the file itself."
  }
  partition_keys {
    name    = "month"
    type    = "string"
    comment = "Partition key, derived from the S3 key path (month=MM, zero-padded) via Athena partition projection -- not a column stored in the file itself."
  }
  partition_keys {
    name    = "day"
    type    = "string"
    comment = "Partition key, derived from the S3 key path (day=DD, zero-padded) via Athena partition projection -- not a column stored in the file itself."
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.curated.bucket}/source=news/"
    input_format  = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat"

    ser_de_info {
      serialization_library = "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe"
    }

    dynamic "columns" {
      for_each = local.news_columns
      content {
        name    = columns.value.name
        type    = columns.value.type
        comment = columns.value.comment
      }
    }
  }
}

resource "aws_glue_catalog_table" "weather_observations" {
  name          = "weather_observations"
  database_name = aws_glue_catalog_database.curated.name
  table_type    = "EXTERNAL_TABLE"

  parameters = merge(local.partition_projection_base, {
    "classification"            = "parquet"
    "storage.location.template" = "s3://${aws_s3_bucket.curated.bucket}/source=weather/year=$${year}/month=$${month}/day=$${day}/"
  })

  partition_keys {
    name    = "year"
    type    = "string"
    comment = "Partition key, derived from the S3 key path (year=YYYY) via Athena partition projection -- not a column stored in the file itself."
  }
  partition_keys {
    name    = "month"
    type    = "string"
    comment = "Partition key, derived from the S3 key path (month=MM, zero-padded) via Athena partition projection -- not a column stored in the file itself."
  }
  partition_keys {
    name    = "day"
    type    = "string"
    comment = "Partition key, derived from the S3 key path (day=DD, zero-padded) via Athena partition projection -- not a column stored in the file itself."
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.curated.bucket}/source=weather/"
    input_format  = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat"

    ser_de_info {
      serialization_library = "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe"
    }

    dynamic "columns" {
      for_each = local.weather_columns
      content {
        name    = columns.value.name
        type    = columns.value.type
        comment = columns.value.comment
      }
    }
  }
}

resource "aws_glue_catalog_table" "crypto_prices" {
  name          = "crypto_prices"
  database_name = aws_glue_catalog_database.curated.name
  table_type    = "EXTERNAL_TABLE"

  parameters = merge(local.partition_projection_base, {
    "classification"            = "parquet"
    "storage.location.template" = "s3://${aws_s3_bucket.curated.bucket}/source=crypto/year=$${year}/month=$${month}/day=$${day}/"
  })

  partition_keys {
    name    = "year"
    type    = "string"
    comment = "Partition key, derived from the S3 key path (year=YYYY) via Athena partition projection -- not a column stored in the file itself."
  }
  partition_keys {
    name    = "month"
    type    = "string"
    comment = "Partition key, derived from the S3 key path (month=MM, zero-padded) via Athena partition projection -- not a column stored in the file itself."
  }
  partition_keys {
    name    = "day"
    type    = "string"
    comment = "Partition key, derived from the S3 key path (day=DD, zero-padded) via Athena partition projection -- not a column stored in the file itself."
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.curated.bucket}/source=crypto/"
    input_format  = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat"

    ser_de_info {
      serialization_library = "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe"
    }

    dynamic "columns" {
      for_each = local.crypto_columns
      content {
        name    = columns.value.name
        type    = columns.value.type
        comment = columns.value.comment
      }
    }
  }
}

resource "aws_glue_catalog_table" "github_repos" {
  name          = "github_repos"
  database_name = aws_glue_catalog_database.curated.name
  table_type    = "EXTERNAL_TABLE"

  parameters = merge(local.partition_projection_base, {
    "classification"            = "parquet"
    "storage.location.template" = "s3://${aws_s3_bucket.curated.bucket}/source=github/year=$${year}/month=$${month}/day=$${day}/"
  })

  partition_keys {
    name    = "year"
    type    = "string"
    comment = "Partition key, derived from the S3 key path (year=YYYY) via Athena partition projection -- not a column stored in the file itself."
  }
  partition_keys {
    name    = "month"
    type    = "string"
    comment = "Partition key, derived from the S3 key path (month=MM, zero-padded) via Athena partition projection -- not a column stored in the file itself."
  }
  partition_keys {
    name    = "day"
    type    = "string"
    comment = "Partition key, derived from the S3 key path (day=DD, zero-padded) via Athena partition projection -- not a column stored in the file itself."
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.curated.bucket}/source=github/"
    input_format  = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat"

    ser_de_info {
      serialization_library = "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe"
    }

    dynamic "columns" {
      for_each = local.github_columns
      content {
        name    = columns.value.name
        type    = columns.value.type
        comment = columns.value.comment
      }
    }
  }
}

resource "aws_glue_catalog_table" "gmail_messages" {
  name          = "gmail_messages"
  database_name = aws_glue_catalog_database.gmail.name
  table_type    = "EXTERNAL_TABLE"

  parameters = merge(local.partition_projection_base, {
    "classification"            = "parquet"
    "storage.location.template" = "s3://${aws_s3_bucket.curated.bucket}/source=gmail/year=$${year}/month=$${month}/day=$${day}/"
  })

  partition_keys {
    name    = "year"
    type    = "string"
    comment = "Partition key, derived from the S3 key path (year=YYYY) via Athena partition projection -- not a column stored in the file itself."
  }
  partition_keys {
    name    = "month"
    type    = "string"
    comment = "Partition key, derived from the S3 key path (month=MM, zero-padded) via Athena partition projection -- not a column stored in the file itself."
  }
  partition_keys {
    name    = "day"
    type    = "string"
    comment = "Partition key, derived from the S3 key path (day=DD, zero-padded) via Athena partition projection -- not a column stored in the file itself."
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.curated.bucket}/source=gmail/"
    input_format  = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat"

    ser_de_info {
      serialization_library = "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe"
    }

    dynamic "columns" {
      for_each = local.gmail_columns
      content {
        name    = columns.value.name
        type    = columns.value.type
        comment = columns.value.comment
      }
    }
  }
}

locals {
  trend_events_columns = [
    { name = "event_id", type = "string", comment = "Synthetic id \"{keyword}-{event_date}\", unique per keyword per day (not guaranteed unique across a re-run of the same day -- see trends/trend_scan.py)." },
    { name = "keyword", type = "string", comment = "The qualifying keyword, lowercase." },
    { name = "event_date", type = "string", comment = "YYYY-MM-DD of the scanned UTC day (also encoded in the year/month/day partition keys, kept here too for easy display without date reassembly)." },
    { name = "github_count", type = "bigint", comment = "Distinct trending GitHub repos mentioning the keyword that day." },
    { name = "hn_count", type = "bigint", comment = "Distinct Hacker News stories mentioning the keyword that day." },
    { name = "news_count", type = "bigint", comment = "Distinct news articles mentioning the keyword that day." },
    { name = "detected_at", type = "string", comment = "ISO 8601 UTC timestamp of when trend_scan ran." },
  ]
}

resource "aws_glue_catalog_table" "trend_events" {
  name          = "trend_events"
  database_name = aws_glue_catalog_database.curated.name
  table_type    = "EXTERNAL_TABLE"

  parameters = merge(local.partition_projection_base, {
    "classification"            = "parquet"
    "storage.location.template" = "s3://${aws_s3_bucket.curated.bucket}/source=trend_events/year=$${year}/month=$${month}/day=$${day}/"
  })

  partition_keys {
    name    = "year"
    type    = "string"
    comment = "Partition key, derived from the S3 key path (year=YYYY) via Athena partition projection -- not a column stored in the file itself."
  }
  partition_keys {
    name    = "month"
    type    = "string"
    comment = "Partition key, derived from the S3 key path (month=MM, zero-padded) via Athena partition projection -- not a column stored in the file itself."
  }
  partition_keys {
    name    = "day"
    type    = "string"
    comment = "Partition key, derived from the S3 key path (day=DD, zero-padded) via Athena partition projection -- not a column stored in the file itself."
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.curated.bucket}/source=trend_events/"
    input_format  = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat"

    ser_de_info {
      serialization_library = "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe"
    }

    dynamic "columns" {
      for_each = local.trend_events_columns
      content {
        name    = columns.value.name
        type    = columns.value.type
        comment = columns.value.comment
      }
    }
  }
}

resource "aws_athena_workgroup" "main" {
  name = "${local.name_prefix}-analytics"

  configuration {
    enforce_workgroup_configuration    = true
    publish_cloudwatch_metrics_enabled = true
    # Hard AWS-enforced cap so the Explorer page's free-form SQL can never
    # scan more than ~1 GiB in a single query (~$0.005 at Athena's
    # $5/TB-scanned rate), regardless of what SQL text produced it.
    bytes_scanned_cutoff_per_query = 1073741824

    result_configuration {
      output_location = "s3://${aws_s3_bucket.curated.bucket}/athena-results/"
    }
  }
}
