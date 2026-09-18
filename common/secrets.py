import json
from functools import lru_cache

import boto3

from . import config


@lru_cache(maxsize=None)
def get_secret(secret_name: str) -> dict:
    client = boto3.client("secretsmanager", region_name=config.AWS_REGION)
    response = client.get_secret_value(SecretId=secret_name)
    return json.loads(response["SecretString"])
