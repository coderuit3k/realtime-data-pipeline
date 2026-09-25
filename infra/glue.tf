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
    { name = "story_id", type = "string" },
    { name = "source", type = "string" },
    { name = "title", type = "string" },
    { name = "text", type = "string" },
    { name = "author", type = "string" },
    { name = "score", type = "bigint" },
    { name = "num_comments", type = "bigint" },
    { name = "url", type = "string" },
    { name = "permalink", type = "string" },
    { name = "created_at", type = "string" },
    { name = "ingested_at", type = "string" },
    { name = "keywords", type = "string" },
  ]

  news_columns = [
    { name = "article_id", type = "string" },
    { name = "source", type = "string" },
    { name = "provider", type = "string" },
    { name = "title", type = "string" },
    { name = "description", type = "string" },
    { name = "url", type = "string" },
    { name = "published_at", type = "string" },
    { name = "ingested_at", type = "string" },
    { name = "keywords", type = "string" },
  ]

  weather_columns = [
    { name = "weather_id", type = "string" },
    { name = "source", type = "string" },
    { name = "location", type = "string" },
    { name = "latitude", type = "double" },
    { name = "longitude", type = "double" },
    { name = "temperature_c", type = "double" },
    { name = "humidity_pct", type = "double" },
    { name = "precipitation_mm", type = "double" },
    { name = "weather_code", type = "bigint" },
    { name = "wind_speed_kmh", type = "double" },
    { name = "observed_at", type = "string" },
    { name = "ingested_at", type = "string" },
    { name = "keywords", type = "string" },
  ]

  crypto_columns = [
    { name = "price_id", type = "string" },
    { name = "source", type = "string" },
    { name = "coin_id", type = "string" },
    { name = "price_usd", type = "double" },
    { name = "market_cap_usd", type = "double" },
    { name = "volume_24h_usd", type = "double" },
    { name = "change_24h_pct", type = "double" },
    { name = "observed_at", type = "string" },
    { name = "ingested_at", type = "string" },
    { name = "keywords", type = "string" },
  ]

  github_columns = [
    { name = "repo_id", type = "string" },
    { name = "source", type = "string" },
    { name = "full_name", type = "string" },
    { name = "description", type = "string" },
    { name = "url", type = "string" },
    { name = "language", type = "string" },
    { name = "stars", type = "bigint" },
    { name = "forks", type = "bigint" },
    { name = "created_at", type = "string" },
    { name = "pushed_at", type = "string" },
    { name = "ingested_at", type = "string" },
    { name = "keywords", type = "string" },
  ]

  gmail_columns = [
    { name = "message_id", type = "string" },
    { name = "source", type = "string" },
    { name = "subject", type = "string" },
    { name = "from_address", type = "string" },
    { name = "snippet", type = "string" },
    { name = "received_at", type = "string" },
    { name = "ingested_at", type = "string" },
    { name = "keywords", type = "string" },
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
    name = "year"
    type = "string"
  }
  partition_keys {
    name = "month"
    type = "string"
  }
  partition_keys {
    name = "day"
    type = "string"
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
        name = columns.value.name
        type = columns.value.type
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
    name = "year"
    type = "string"
  }
  partition_keys {
    name = "month"
    type = "string"
  }
  partition_keys {
    name = "day"
    type = "string"
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
        name = columns.value.name
        type = columns.value.type
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
    name = "year"
    type = "string"
  }
  partition_keys {
    name = "month"
    type = "string"
  }
  partition_keys {
    name = "day"
    type = "string"
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
        name = columns.value.name
        type = columns.value.type
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
    name = "year"
    type = "string"
  }
  partition_keys {
    name = "month"
    type = "string"
  }
  partition_keys {
    name = "day"
    type = "string"
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
        name = columns.value.name
        type = columns.value.type
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
    name = "year"
    type = "string"
  }
  partition_keys {
    name = "month"
    type = "string"
  }
  partition_keys {
    name = "day"
    type = "string"
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
        name = columns.value.name
        type = columns.value.type
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
    name = "year"
    type = "string"
  }
  partition_keys {
    name = "month"
    type = "string"
  }
  partition_keys {
    name = "day"
    type = "string"
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
        name = columns.value.name
        type = columns.value.type
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
