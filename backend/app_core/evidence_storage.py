"""Private S3-compatible evidence storage.

Supabase Storage exposes an S3-compatible endpoint. Configure the EVIDENCE_STORAGE_*
environment variables to keep customer evidence out of PostgreSQL while preserving
authenticated application access through the API.
"""
from __future__ import annotations

import asyncio
import base64
import io
import os
import re
import uuid
from typing import Optional

from fastapi import HTTPException
from PIL import Image, ImageOps

MAX_SOURCE_BYTES = 20 * 1024 * 1024
MAX_DIMENSION = 1600
JPEG_QUALITY = 78

def _safe_segment(value: Optional[str], fallback: str = "system") -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", str(value or fallback)).strip("._")
    return cleaned[:120] or fallback

def _client():
    bucket = os.environ.get("EVIDENCE_STORAGE_BUCKET", "").strip()
    endpoint = os.environ.get("EVIDENCE_STORAGE_ENDPOINT", "").strip()
    access_key = os.environ.get("EVIDENCE_STORAGE_ACCESS_KEY", "").strip()
    secret_key = os.environ.get("EVIDENCE_STORAGE_SECRET_KEY", "").strip()
    if not all([bucket, endpoint, access_key, secret_key]):
        return None, None
    import boto3
    from botocore.config import Config
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name=os.environ.get("EVIDENCE_STORAGE_REGION", "eu-west-2"),
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4"),
    ), bucket

def configured() -> bool:
    client, bucket = _client()
    return bool(client and bucket)

def optimise_image(content: bytes) -> bytes:
    if len(content) > MAX_SOURCE_BYTES:
        raise HTTPException(status_code=413, detail="Image is too large (max 20 MB)")
    try:
        with Image.open(io.BytesIO(content)) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
            image.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.Resampling.LANCZOS)
            output = io.BytesIO()
            image.save(output, format="JPEG", quality=JPEG_QUALITY, optimize=True)
            return output.getvalue()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Upload a valid image file") from exc

async def store_evidence(content: bytes, *, company_id: Optional[str], uploaded_by: str, filename: str = "evidence.jpg") -> dict:
    client, bucket = _client()
    if not client or not bucket:
        raise HTTPException(status_code=503, detail="Private evidence storage is not configured")
    photo_id = str(uuid.uuid4())
    key = f"companies/{_safe_segment(company_id)}/evidence/{photo_id}.jpg"
    await asyncio.to_thread(
        client.put_object,
        Bucket=bucket,
        Key=key,
        Body=content,
        ContentType="image/jpeg",
        ServerSideEncryption="AES256",
        Metadata={"uploaded-by": _safe_segment(uploaded_by), "original-name": _safe_segment(filename, "evidence")},
    )
    return {"id": photo_id, "storage_backend": "s3", "storage_key": key, "content_type": "image/jpeg", "size": len(content)}

async def read_evidence(photo: dict) -> bytes:
    client, bucket = _client()
    if not client or not bucket:
        raise HTTPException(status_code=503, detail="Private evidence storage is not configured")
    response = await asyncio.to_thread(client.get_object, Bucket=bucket, Key=photo["storage_key"])
    return await asyncio.to_thread(response["Body"].read)

def legacy_data_url(photo: dict) -> Optional[bytes]:
    value = photo.get("data")
    if not isinstance(value, str) or "," not in value:
        return None
    try:
        return base64.b64decode(value.split(",", 1)[1])
    except Exception:
        return None
