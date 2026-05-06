"""Storage abstraction: local filesystem (dev) or Google Cloud Storage (prod).

Switched by env var STORAGE_BACKEND ('local'|'gcs').

Public API:
  write_bytes(uri: str, data: bytes) -> str   # returns canonical URI
  read_bytes(uri: str) -> bytes
  exists(uri: str) -> bool

URIs:
  local:  file:///abs/path  (or relative path under STORAGE_DIR)
  gcs:    gs://bucket/key
"""

from __future__ import annotations

import os
from pathlib import Path


def _backend() -> str:
    return os.environ.get("STORAGE_BACKEND", "local")


def _local_root() -> Path:
    return Path(os.environ.get("STORAGE_DIR", "./storage")).resolve()


def write_bytes(uri: str, data: bytes) -> str:
    if _backend() == "local":
        path = _local_root() / uri.lstrip("/")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return f"file://{path}"
    raise NotImplementedError("phase 1: gcs backend")


def read_bytes(uri: str) -> bytes:
    if uri.startswith("file://"):
        return Path(uri[len("file://") :]).read_bytes()
    raise NotImplementedError("phase 1: gcs backend")


def exists(uri: str) -> bool:
    if uri.startswith("file://"):
        return Path(uri[len("file://") :]).exists()
    raise NotImplementedError("phase 1: gcs backend")
