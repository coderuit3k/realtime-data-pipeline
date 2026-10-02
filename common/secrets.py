"""Secrets Manager access for API keys and OAuth credentials."""

import json
from functools import lru_cache

import boto3

from . import config


@lru_cache(maxsize=None)
def get_secret(secret_name: str) -> dict:
    """Return the secret's JSON payload.

    Cached for the container's lifetime, so a rotated secret is only picked up
    after a cold start.
    """
    client = boto3.client("secretsmanager", region_name=config.AWS_REGION)
    response = client.get_secret_value(SecretId=secret_name)
    return json.loads(response["SecretString"])
