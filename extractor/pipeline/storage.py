"""Storage abstraction: local filesystem (dev) or Google Cloud Storage (prod).

Switched by env var STORAGE_BACKEND ('local'|'gcs').

Public API:
  write_bytes(key: str, data: bytes) -> str   # returns canonical URI
  read_bytes(uri: str) -> bytes
  resolve_uri_to_local(uri: str) -> str       # downloads to tmp if needed
  exists(uri: str) -> bool

URIs:
  local:  file:///abs/path  (or relative path under STORAGE_DIR)
  gcs:    gs://bucket/key
"""

from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path


def _backend() -> str:
    return os.environ.get("STORAGE_BACKEND", "local")


def _local_root() -> Path:
    return Path(os.environ.get("STORAGE_DIR", "./storage")).resolve()


def _bucket() -> str:
    bucket = os.environ.get("STORAGE_BUCKET")
    if not bucket:
        raise RuntimeError("STORAGE_BUCKET required for gcs backend")
    return bucket


def _parse_gs(uri: str) -> tuple[str, str]:
    m = re.match(r"^gs://([^/]+)/(.+)$", uri)
    if not m:
        raise ValueError(f"bad gs uri: {uri}")
    return m.group(1), m.group(2)


def write_bytes(key: str, data: bytes) -> str:
    if _backend() == "local":
        path = _local_root() / key.lstrip("/")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return f"file://{path}"
    from google.cloud import storage as gcs  # type: ignore

    client = gcs.Client()
    bucket = client.bucket(_bucket())
    blob = bucket.blob(key)
    blob.upload_from_string(data)
    return f"gs://{_bucket()}/{key}"


def read_bytes(uri: str) -> bytes:
    if uri.startswith("file://"):
        return Path(uri[len("file://") :]).read_bytes()
    if uri.startswith("gs://"):
        from google.cloud import storage as gcs  # type: ignore

        bucket_name, key = _parse_gs(uri)
        client = gcs.Client()
        return client.bucket(bucket_name).blob(key).download_as_bytes()
    raise ValueError(f"unsupported uri: {uri}")


def resolve_uri_to_local(uri: str) -> str:
    """Return a local path. For gs:// URIs, download to a temp file."""
    if uri.startswith("file://"):
        return uri[len("file://") :]
    if uri.startswith("gs://"):
        data = read_bytes(uri)
        suffix = Path(uri).suffix or ".bin"
        fd, path = tempfile.mkstemp(suffix=suffix, prefix="esat_")
        os.close(fd)
        Path(path).write_bytes(data)
        return path
    raise ValueError(f"unsupported uri: {uri}")


def exists(uri: str) -> bool:
    if uri.startswith("file://"):
        return Path(uri[len("file://") :]).exists()
    if uri.startswith("gs://"):
        from google.cloud import storage as gcs  # type: ignore

        bucket_name, key = _parse_gs(uri)
        client = gcs.Client()
        return client.bucket(bucket_name).blob(key).exists()
    raise ValueError(f"unsupported uri: {uri}")
