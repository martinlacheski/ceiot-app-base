"""Object storage (S3 API, SeaweedFS in compose) for the admin documents corpus.

The browser never talks to object storage: files are uploaded and downloaded
through the authenticated API. boto3 is blocking, so every call runs in the
threadpool and the public surface is async. The feature is optional: without
endpoint and keys, ``get_storage`` answers 503 "Almacenamiento no configurado"
and the rest of the application keeps working.
"""

import hashlib
import logging
import threading
from functools import lru_cache
from typing import AsyncIterator, BinaryIO, Protocol

import boto3
from boto3.s3.transfer import TransferConfig
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException, status
from starlette.concurrency import iterate_in_threadpool, run_in_threadpool

from app.core.config import settings

logger = logging.getLogger(__name__)

CHUNK_SIZE = 64 * 1024
# Above the API upload cap, so an upload is a single PUT with a plain MD5 ETag.
MULTIPART_THRESHOLD = 64 * 1024 * 1024
_MISSING_CODES = {"404", "NoSuchKey", "NotFound", "NoSuchBucket"}


class StorageUnavailable(RuntimeError):
    """The object store failed or could not be reached."""


class StorageObjectMissing(StorageUnavailable):
    """The requested object does not exist."""


class ObjectStorage(Protocol):
    async def put(
        self, key: str, fileobj: BinaryIO, *, content_type: str, sha256: str, size: int
    ) -> None: ...

    async def exists(self, key: str) -> bool: ...

    def stream(self, key: str) -> AsyncIterator[bytes]: ...

    async def delete(self, key: str) -> None: ...


def _error_code(error: ClientError) -> str:
    return str(error.response.get("Error", {}).get("Code", ""))


class S3Storage:
    def __init__(
        self,
        *,
        endpoint_url: str,
        bucket: str,
        access_key: str,
        secret_key: str,
        region: str = "us-east-1",
    ) -> None:
        self.bucket = bucket
        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region,
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "path"},
                retries={"max_attempts": 2, "mode": "standard"},
                connect_timeout=3,
                read_timeout=30,
            ),
        )
        self._bucket_ready = False
        self._bucket_lock = threading.Lock()

    # -- blocking helpers (always run in the threadpool) -----------------

    def _ensure_bucket(self) -> None:
        """Create the bucket on first use; afterwards this is a flag check."""
        if self._bucket_ready:
            return
        with self._bucket_lock:
            if self._bucket_ready:
                return
            try:
                self._client.head_bucket(Bucket=self.bucket)
            except ClientError as error:
                if _error_code(error) not in _MISSING_CODES:
                    raise
                try:
                    self._client.create_bucket(Bucket=self.bucket)
                except ClientError as create_error:
                    if _error_code(create_error) not in {"BucketAlreadyOwnedByYou", "BucketAlreadyExists"}:
                        raise
            self._bucket_ready = True

    @staticmethod
    def _verify_source(fileobj: BinaryIO, sha256: str, size: int) -> None:
        digest = hashlib.sha256()
        total = 0
        fileobj.seek(0)
        while chunk := fileobj.read(CHUNK_SIZE):
            digest.update(chunk)
            total += len(chunk)
        fileobj.seek(0)
        if total != size or digest.hexdigest() != sha256:
            raise ValueError("The bytes to store do not match the declared sha256 and size")

    def _put(self, key: str, fileobj: BinaryIO, content_type: str, sha256: str, size: int) -> None:
        self._verify_source(fileobj, sha256, size)
        self._ensure_bucket()
        self._client.upload_fileobj(
            fileobj,
            self.bucket,
            key,
            ExtraArgs={"ContentType": content_type, "Metadata": {"sha256": sha256}},
            Config=TransferConfig(multipart_threshold=MULTIPART_THRESHOLD),
        )
        # Write verification: what the store reports must be what we sent.
        head = self._client.head_object(Bucket=self.bucket, Key=key)
        if head["ContentLength"] != size or head.get("Metadata", {}).get("sha256") != sha256:
            self._client.delete_object(Bucket=self.bucket, Key=key)
            raise StorageUnavailable("Stored object failed verification")

    def _exists(self, key: str) -> bool:
        try:
            self._client.head_object(Bucket=self.bucket, Key=key)
        except ClientError as error:
            if _error_code(error) in _MISSING_CODES:
                return False
            raise
        return True

    def _delete(self, key: str) -> None:
        try:
            self._client.delete_object(Bucket=self.bucket, Key=key)
        except ClientError as error:
            if _error_code(error) not in _MISSING_CODES:
                raise

    def _open(self, key: str):
        try:
            return self._client.get_object(Bucket=self.bucket, Key=key)["Body"]
        except ClientError as error:
            if _error_code(error) in _MISSING_CODES:
                raise StorageObjectMissing(key) from error
            raise

    # -- async surface ---------------------------------------------------

    @staticmethod
    async def _call(function, *args):
        try:
            return await run_in_threadpool(function, *args)
        except StorageUnavailable:
            raise
        except (BotoCoreError, ClientError) as error:
            logger.warning("Object storage request failed: %s", type(error).__name__)
            raise StorageUnavailable(type(error).__name__) from error

    async def put(
        self, key: str, fileobj: BinaryIO, *, content_type: str, sha256: str, size: int
    ) -> None:
        await self._call(self._put, key, fileobj, content_type, sha256, size)

    async def exists(self, key: str) -> bool:
        return await self._call(self._exists, key)

    async def delete(self, key: str) -> None:
        await self._call(self._delete, key)

    async def stream(self, key: str, chunk_size: int = CHUNK_SIZE) -> AsyncIterator[bytes]:
        body = await self._call(self._open, key)
        try:
            async for chunk in iterate_in_threadpool(body.iter_chunks(chunk_size)):
                yield chunk
        except (BotoCoreError, ClientError) as error:
            raise StorageUnavailable(type(error).__name__) from error
        finally:
            await run_in_threadpool(body.close)


@lru_cache(maxsize=4)
def _build(endpoint_url: str, bucket: str, access_key: str, secret_key: str, region: str) -> S3Storage:
    return S3Storage(
        endpoint_url=endpoint_url,
        bucket=bucket,
        access_key=access_key,
        secret_key=secret_key,
        region=region,
    )


def get_storage() -> S3Storage:
    """FastAPI dependency: the shared client, or 503 when storage is not configured."""
    access_key, secret_key = settings.S3_ACCESS_KEY, settings.S3_SECRET_KEY
    if not (settings.S3_ENDPOINT_URL and access_key and secret_key):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Almacenamiento no configurado",
        )
    return _build(
        settings.S3_ENDPOINT_URL,
        settings.S3_BUCKET,
        access_key.get_secret_value(),
        secret_key.get_secret_value(),
        settings.S3_REGION,
    )
