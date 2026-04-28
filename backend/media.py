from __future__ import annotations

import hashlib
import hmac
import os
import re
import shutil
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO
from urllib.parse import quote

from . import database

ALLOWED_MIME_TYPES = {
    "image/jpeg": "image",
    "image/png": "image",
    "image/webp": "image",
    "video/mp4": "video",
    "video/webm": "video",
}

EXTENSIONS_BY_MIME = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
}

CHUNK_SIZE = 1024 * 1024
DEFAULT_IMAGE_LIMIT_MB = 10
DEFAULT_VIDEO_LIMIT_MB = 100
DEFAULT_MEDIA_URL_TTL_SECONDS = 6 * 60 * 60

MEDIA_STORAGE_PROVIDER = (os.getenv("MEDIA_STORAGE_PROVIDER", "local").strip().lower() or "local")
MEDIA_S3_ENDPOINT = os.getenv("MEDIA_S3_ENDPOINT", "").strip() or None
MEDIA_S3_REGION = os.getenv("MEDIA_S3_REGION", "").strip() or None
MEDIA_S3_BUCKET = os.getenv("MEDIA_S3_BUCKET", "").strip() or None
MEDIA_S3_ACCESS_KEY = os.getenv("MEDIA_S3_ACCESS_KEY", "").strip() or None
MEDIA_S3_SECRET_KEY = os.getenv("MEDIA_S3_SECRET_KEY", "").strip() or None
MEDIA_S3_PUBLIC_BASE_URL = os.getenv("MEDIA_S3_PUBLIC_BASE_URL", "").strip().rstrip("/") or None
MEDIA_LOCAL_ROOT = Path(os.getenv("MEDIA_LOCAL_ROOT", str(Path(__file__).resolve().parent / "media_storage"))).resolve()
MEDIA_URL_SECRET = (
    os.getenv("MEDIA_URL_SECRET", "").strip()
    or os.getenv("ONEC_SHARED_SECRET", "").strip()
    or os.getenv("API_TOKEN", "").strip()
    or "dev-media-url-secret"
)


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        value = int(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer") from exc
    if value <= 0:
        raise RuntimeError(f"{name} must be > 0")
    return value


MAX_IMAGE_SIZE_BYTES = _int_env("MAX_IMAGE_SIZE_MB", DEFAULT_IMAGE_LIMIT_MB) * 1024 * 1024
MAX_VIDEO_SIZE_BYTES = _int_env("MAX_VIDEO_SIZE_MB", DEFAULT_VIDEO_LIMIT_MB) * 1024 * 1024
MAX_UPLOAD_SIZE_BYTES = max(MAX_IMAGE_SIZE_BYTES, MAX_VIDEO_SIZE_BYTES)

_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._()\- ]+")
_SAFE_OBJECT_KEY_RE = re.compile(r"^[A-Za-z0-9._\-/]+$")


class MediaValidationError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass
class MediaDescriptor:
    media_id: int
    storage_provider: str
    bucket: str
    object_key: str
    sha256: str
    mime_type: str
    size_bytes: int
    original_name: str
    kind: str
    width: int | None
    height: int | None
    duration_sec: float | None
    created_at: str


class StorageBackend:
    provider_name: str

    def save_file(self, temp_path: Path, object_key: str, content_type: str) -> tuple[str, str, str]:
        raise NotImplementedError

    def get_download_url(self, media: MediaDescriptor, expires_in: int) -> str | None:
        return None

    def get_local_path(self, media: MediaDescriptor) -> Path | None:
        return None


class LocalStorageBackend(StorageBackend):
    provider_name = "local"

    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def save_file(self, temp_path: Path, object_key: str, content_type: str) -> tuple[str, str, str]:
        safe_key = _sanitize_object_key(object_key)
        target = (self.root / safe_key).resolve()
        if not str(target).startswith(str(self.root)):
            raise MediaValidationError("Invalid object key", status_code=400)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(temp_path, target)
        return self.provider_name, "local", safe_key

    def get_local_path(self, media: MediaDescriptor) -> Path | None:
        safe_key = _sanitize_object_key(media.object_key)
        target = (self.root / safe_key).resolve()
        if not str(target).startswith(str(self.root)):
            raise MediaValidationError("Invalid object key", status_code=400)
        return target


class S3StorageBackend(StorageBackend):
    provider_name = "s3"

    def __init__(self) -> None:
        if not MEDIA_S3_BUCKET:
            raise RuntimeError("MEDIA_S3_BUCKET is required for s3 media storage")
        if not MEDIA_S3_ACCESS_KEY or not MEDIA_S3_SECRET_KEY:
            raise RuntimeError("MEDIA_S3_ACCESS_KEY and MEDIA_S3_SECRET_KEY are required for s3 media storage")
        try:
            import boto3
        except ImportError as exc:
            raise RuntimeError("boto3 is required for MEDIA_STORAGE_PROVIDER=s3") from exc
        client_kwargs = {
            "service_name": "s3",
            "aws_access_key_id": MEDIA_S3_ACCESS_KEY,
            "aws_secret_access_key": MEDIA_S3_SECRET_KEY,
        }
        if MEDIA_S3_REGION:
            client_kwargs["region_name"] = MEDIA_S3_REGION
        if MEDIA_S3_ENDPOINT:
            client_kwargs["endpoint_url"] = MEDIA_S3_ENDPOINT
        self.bucket = MEDIA_S3_BUCKET
        self.public_base_url = MEDIA_S3_PUBLIC_BASE_URL
        self.client = boto3.client(**client_kwargs)

    def save_file(self, temp_path: Path, object_key: str, content_type: str) -> tuple[str, str, str]:
        safe_key = _sanitize_object_key(object_key)
        self.client.upload_file(
            str(temp_path),
            self.bucket,
            safe_key,
            ExtraArgs={"ContentType": content_type},
        )
        return self.provider_name, self.bucket, safe_key

    def get_download_url(self, media: MediaDescriptor, expires_in: int) -> str | None:
        if self.public_base_url:
            return self.public_base_url + "/" + quote(media.object_key)
        return self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": media.bucket, "Key": media.object_key},
            ExpiresIn=max(60, int(expires_in)),
        )


class MediaService:
    def __init__(self) -> None:
        self.local_backend = LocalStorageBackend(MEDIA_LOCAL_ROOT)
        self._s3_backend: S3StorageBackend | None = None

    def _get_write_backend(self) -> StorageBackend:
        if MEDIA_STORAGE_PROVIDER == "s3":
            return self._get_s3_backend()
        return self.local_backend

    def _get_s3_backend(self) -> S3StorageBackend:
        if self._s3_backend is None:
            self._s3_backend = S3StorageBackend()
        return self._s3_backend

    def get_backend_for_media(self, media: MediaDescriptor) -> StorageBackend:
        if media.storage_provider == "s3":
            return self._get_s3_backend()
        return self.local_backend

    def ingest_upload(
        self,
        stream: BinaryIO,
        *,
        original_name: str | None,
        claimed_mime_type: str | None,
    ) -> MediaDescriptor:
        temp_path, sha256_hex, size_bytes, head = _read_stream_to_temp_file(stream)
        try:
            mime_type = _detect_mime_type(head, claimed_mime_type)
            kind = ALLOWED_MIME_TYPES.get(mime_type)
            if kind is None:
                raise MediaValidationError("Unsupported media type", status_code=415)
            _enforce_size_limit(kind, size_bytes)
            width, height = _extract_dimensions(temp_path, mime_type)
            duration_sec = _extract_duration_seconds(temp_path, mime_type)
            normalized_name = _normalize_original_name(original_name, mime_type)

            existing = database.find_media_file_by_fingerprint(sha256_hex, size_bytes, mime_type)
            if existing is not None:
                return _descriptor_from_record(existing)

            object_key = _build_object_key(kind, sha256_hex, mime_type)
            backend = self._get_write_backend()
            storage_provider, bucket, stored_object_key = backend.save_file(temp_path, object_key, mime_type)
            media_record = database.create_media_file(
                storage_provider=storage_provider,
                bucket=bucket,
                object_key=stored_object_key,
                sha256=sha256_hex,
                mime_type=mime_type,
                size_bytes=size_bytes,
                original_name=normalized_name,
                width=width,
                height=height,
                duration_sec=duration_sec,
            )
            return _descriptor_from_record(media_record)
        finally:
            try:
                temp_path.unlink(missing_ok=True)
            except Exception:
                pass

    def get_media_descriptor(self, media_id: int) -> MediaDescriptor | None:
        row = database.get_media_file(int(media_id))
        if row is None:
            return None
        return _descriptor_from_record(row)

    def get_direct_download_url(self, media: MediaDescriptor, expires_in: int = DEFAULT_MEDIA_URL_TTL_SECONDS) -> str | None:
        backend = self.get_backend_for_media(media)
        return backend.get_download_url(media, expires_in)

    def get_local_path(self, media: MediaDescriptor) -> Path | None:
        backend = self.get_backend_for_media(media)
        return backend.get_local_path(media)

    def build_signed_media_url(
        self,
        *,
        base_url: str,
        media_id: int,
        variant: str = "original",
        expires_in: int = DEFAULT_MEDIA_URL_TTL_SECONDS,
    ) -> str:
        expires_at = int(time.time()) + max(60, int(expires_in))
        signature = sign_media_access(media_id=media_id, variant=variant, expires_at=expires_at)
        separator = "&" if "?" in base_url else "?"
        return f"{base_url}{separator}expires={expires_at}&signature={signature}&variant={quote(variant)}"


media_service = MediaService()


def sign_media_access(*, media_id: int, variant: str, expires_at: int) -> str:
    payload = f"{int(media_id)}:{variant}:{int(expires_at)}".encode("utf-8")
    return hmac.new(MEDIA_URL_SECRET.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def verify_media_access(*, media_id: int, variant: str, expires_at: int, signature: str | None) -> bool:
    if not signature:
        return False
    if int(expires_at) < int(time.time()):
        return False
    expected = sign_media_access(media_id=media_id, variant=variant, expires_at=expires_at)
    return hmac.compare_digest(expected, signature)


def _descriptor_from_record(record: dict) -> MediaDescriptor:
    return MediaDescriptor(
        media_id=int(record["id"]),
        storage_provider=str(record["storage_provider"]),
        bucket=str(record["bucket"]),
        object_key=str(record["object_key"]),
        sha256=str(record["sha256"]),
        mime_type=str(record["mime_type"]),
        size_bytes=int(record["size_bytes"]),
        original_name=str(record["original_name"]),
        kind=ALLOWED_MIME_TYPES.get(str(record["mime_type"]), "image"),
        width=int(record["width"]) if record.get("width") is not None else None,
        height=int(record["height"]) if record.get("height") is not None else None,
        duration_sec=float(record["duration_sec"]) if record.get("duration_sec") is not None else None,
        created_at=str(record["created_at"]),
    )


def _sanitize_object_key(object_key: str) -> str:
    normalized = (object_key or "").replace("\\", "/").strip("/")
    if not normalized or ".." in normalized or not _SAFE_OBJECT_KEY_RE.match(normalized):
        raise MediaValidationError("Invalid object key", status_code=400)
    return normalized


def _normalize_original_name(original_name: str | None, mime_type: str) -> str:
    candidate = (original_name or "").replace("\\", "/").split("/")[-1].strip()
    if not candidate:
        candidate = "upload" + EXTENSIONS_BY_MIME[mime_type]
    candidate = _SAFE_NAME_RE.sub("_", candidate)
    candidate = re.sub(r"\s+", " ", candidate).strip(" .")
    if not candidate:
        candidate = "upload" + EXTENSIONS_BY_MIME[mime_type]
    ext = EXTENSIONS_BY_MIME[mime_type]
    lower_candidate = candidate.lower()
    if not lower_candidate.endswith(ext):
        candidate = candidate + ext
    return candidate[:255]


def _build_object_key(kind: str, sha256_hex: str, mime_type: str) -> str:
    ext = EXTENSIONS_BY_MIME[mime_type]
    return f"{kind}/{sha256_hex[:2]}/{sha256_hex[2:4]}/{sha256_hex}{ext}"


def _read_stream_to_temp_file(stream: BinaryIO) -> tuple[Path, str, int, bytes]:
    digest = hashlib.sha256()
    total_size = 0
    first_bytes = b""
    fd, temp_name = tempfile.mkstemp(prefix="mtb-media-", suffix=".bin")
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "wb") as tmp:
            while True:
                chunk = stream.read(CHUNK_SIZE)
                if not chunk:
                    break
                if isinstance(chunk, str):
                    chunk = chunk.encode("utf-8")
                total_size += len(chunk)
                if total_size > MAX_UPLOAD_SIZE_BYTES:
                    raise MediaValidationError("Uploaded file exceeds configured size limit", status_code=413)
                if len(first_bytes) < 512:
                    first_bytes += chunk[: 512 - len(first_bytes)]
                digest.update(chunk)
                tmp.write(chunk)
        if total_size <= 0:
            raise MediaValidationError("Uploaded file is empty", status_code=400)
        return temp_path, digest.hexdigest(), total_size, first_bytes
    except Exception:
        try:
            temp_path.unlink(missing_ok=True)
        except Exception:
            pass
        raise


def _detect_mime_type(head: bytes, claimed_mime_type: str | None) -> str:
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return "video/webm"
    if len(head) >= 12 and head[4:8] == b"ftyp":
        return "video/mp4"

    claimed = (claimed_mime_type or "").strip().lower()
    if claimed in ALLOWED_MIME_TYPES:
        return claimed
    raise MediaValidationError("Unsupported media signature", status_code=415)


def _enforce_size_limit(kind: str, size_bytes: int) -> None:
    if kind == "image" and size_bytes > MAX_IMAGE_SIZE_BYTES:
        raise MediaValidationError(
            f"Image is too large. Limit is {MAX_IMAGE_SIZE_BYTES // (1024 * 1024)} MB",
            status_code=413,
        )
    if kind == "video" and size_bytes > MAX_VIDEO_SIZE_BYTES:
        raise MediaValidationError(
            f"Video is too large. Limit is {MAX_VIDEO_SIZE_BYTES // (1024 * 1024)} MB",
            status_code=413,
        )


def _extract_dimensions(path: Path, mime_type: str) -> tuple[int | None, int | None]:
    if mime_type == "image/png":
        data = path.read_bytes()[:32]
        if len(data) >= 24:
            return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
        return None, None
    if mime_type == "image/jpeg":
        return _extract_jpeg_dimensions(path)
    if mime_type == "image/webp":
        return _extract_webp_dimensions(path)
    return None, None


def _extract_jpeg_dimensions(path: Path) -> tuple[int | None, int | None]:
    with path.open("rb") as fh:
        data = fh.read()
    index = 2
    length = len(data)
    while index + 9 < length:
        if data[index] != 0xFF:
            index += 1
            continue
        marker = data[index + 1]
        index += 2
        if marker in (0xD8, 0xD9):
            continue
        if index + 2 > length:
            break
        block_size = int.from_bytes(data[index:index + 2], "big")
        if block_size < 2 or index + block_size > length:
            break
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            if index + 7 <= length:
                height = int.from_bytes(data[index + 3:index + 5], "big")
                width = int.from_bytes(data[index + 5:index + 7], "big")
                return width, height
            break
        index += block_size
    return None, None


def _extract_webp_dimensions(path: Path) -> tuple[int | None, int | None]:
    data = path.read_bytes()[:64]
    if len(data) < 30:
        return None, None
    chunk_type = data[12:16]
    if chunk_type == b"VP8X" and len(data) >= 30:
        width = 1 + int.from_bytes(data[24:27], "little")
        height = 1 + int.from_bytes(data[27:30], "little")
        return width, height
    if chunk_type == b"VP8L" and len(data) >= 25:
        b0, b1, b2, b3 = data[21], data[22], data[23], data[24]
        width = 1 + (((b1 & 0x3F) << 8) | b0)
        height = 1 + (((b3 & 0x0F) << 10) | (b2 << 2) | ((b1 & 0xC0) >> 6))
        return width, height
    if chunk_type == b"VP8 " and len(data) >= 30 and data[23:26] == b"\x9d\x01\x2a":
        width = int.from_bytes(data[26:28], "little") & 0x3FFF
        height = int.from_bytes(data[28:30], "little") & 0x3FFF
        return width, height
    return None, None


def _extract_duration_seconds(path: Path, mime_type: str) -> float | None:
    if mime_type == "video/mp4":
        return _extract_mp4_duration(path)
    return None


def _extract_mp4_duration(path: Path) -> float | None:
    data = path.read_bytes()[:1024 * 1024]
    idx = data.find(b"mvhd")
    if idx < 0 or idx + 24 >= len(data):
        return None
    version = data[idx + 4]
    if version == 0 and idx + 24 <= len(data):
        timescale = int.from_bytes(data[idx + 16:idx + 20], "big")
        duration = int.from_bytes(data[idx + 20:idx + 24], "big")
    elif version == 1 and idx + 36 <= len(data):
        timescale = int.from_bytes(data[idx + 28:idx + 32], "big")
        duration = int.from_bytes(data[idx + 32:idx + 40], "big")
    else:
        return None
    if timescale <= 0:
        return None
    return round(duration / float(timescale), 3)
