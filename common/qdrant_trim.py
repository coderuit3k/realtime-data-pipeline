"""Trim datapulse-rag theo sliding window — giữ free tier Qdrant Cloud.

Chạy tay trước để xem số lượng (dry-run), rồi mới xóa thật.
Khuyến nghị: schedule hàng tuần qua EventBridge (gắn vào Lambda có sẵn).

Yêu cầu: QDRANT_URL, QDRANT_API_KEY trong env. qdrant-client đã có trong repo.
"""

import os
import time

from dotenv import load_dotenv
from qdrant_client import QdrantClient
from qdrant_client.models import FieldCondition, Filter, Range

COLLECTION = "datapulse-rag"
WINDOW_DAYS = 60  # đổi nếu cần; xem ghi chú bên dưới

load_dotenv()

def trim_old_points(days: int = WINDOW_DAYS, dry_run: bool = True) -> int:
    client = QdrantClient(
        url=os.environ["QDRANT_URL"],
        api_key=os.environ["QDRANT_API_KEY"],
    )
    cutoff = int(time.time()) - days * 86400
    old_filter = Filter(
        must=[FieldCondition(key="published_ts", range=Range(lt=cutoff))]
    )

    n = client.count(collection_name=COLLECTION, count_filter=old_filter).count
    print(f"points cũ hơn {days} ngày: {n}")

    # Points nào chưa có published_ts (backfill sót) sẽ KHÔNG bị xóa —
    # kiểm tra riêng trước khi tin con số này.
    missing = client.count(
        collection_name=COLLECTION,
        count_filter=Filter(
            must_not=[FieldCondition(key="published_ts", range=Range(gte=0))]
        ),
    ).count
    if missing:
        print(f"CẢNH BÁO: {missing} points thiếu published_ts (không nằm trong diện xóa)")

    if dry_run or n == 0:
        print("dry-run: chưa xóa gì")
        return n

    client.delete(collection_name=COLLECTION, points_selector=old_filter)
    print(f"đã xóa {n} points")
    return n


if __name__ == "__main__":
    import sys

    dry = "--delete" not in sys.argv
    trim_old_points(dry_run=dry)
    if dry:
        print('chạy lại với cờ --delete để xóa thật')
