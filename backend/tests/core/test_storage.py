"""S3 storage client: signed access, bucket bootstrap, verified writes, streaming."""

import hashlib
import io

import boto3
import pytest
from fastapi import HTTPException
from moto import mock_aws

from app.core import storage as storage_module
from app.core.storage import S3Storage, StorageUnavailable, get_storage

pytestmark = pytest.mark.asyncio

DATA = b"0123456789" * 1000


@pytest.fixture(name="aws")
def aws_fixture(monkeypatch):
    for name in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"):
        monkeypatch.setenv(name, "testing")
    with mock_aws():
        yield


def make_storage(**overrides):
    kwargs = dict(
        endpoint_url="https://s3.amazonaws.com",  # moto intercepts AWS hosts only
        bucket="test-bucket",
        access_key="testing",
        secret_key="testing",
        region="us-east-1",
    )
    kwargs.update(overrides)
    return S3Storage(**kwargs)


async def collect(stream):
    return b"".join([chunk async for chunk in stream])


async def test_put_creates_the_bucket_once_and_stores_verified_object(aws):
    storage = make_storage()
    await storage.put("documents/a.txt", io.BytesIO(DATA), content_type="text/plain",
                      sha256=hashlib.sha256(DATA).hexdigest(), size=len(DATA))
    await storage.put("documents/b.txt", io.BytesIO(DATA), content_type="text/plain",
                      sha256=hashlib.sha256(DATA).hexdigest(), size=len(DATA))

    client = boto3.client("s3", region_name="us-east-1")
    assert [b["Name"] for b in client.list_buckets()["Buckets"]] == ["test-bucket"]
    head = client.head_object(Bucket="test-bucket", Key="documents/a.txt")
    assert head["ContentType"] == "text/plain"
    assert head["Metadata"]["sha256"] == hashlib.sha256(DATA).hexdigest()
    assert storage._bucket_ready is True


async def test_stream_yields_the_object_in_chunks(aws):
    storage = make_storage()
    await storage.put("k", io.BytesIO(DATA), content_type="text/plain",
                      sha256=hashlib.sha256(DATA).hexdigest(), size=len(DATA))
    chunks = [chunk async for chunk in storage.stream("k", chunk_size=4096)]
    assert len(chunks) > 1 and max(len(c) for c in chunks) <= 4096
    assert b"".join(chunks) == DATA


async def test_exists_and_idempotent_delete(aws):
    storage = make_storage()
    assert await storage.exists("missing") is False
    await storage.put("k", io.BytesIO(b"x"), content_type="text/plain",
                      sha256=hashlib.sha256(b"x").hexdigest(), size=1)
    assert await storage.exists("k") is True
    await storage.delete("k")
    await storage.delete("k")
    assert await storage.exists("k") is False


async def test_put_refuses_bytes_that_do_not_match_the_declared_hash_or_size(aws):
    storage = make_storage()
    with pytest.raises(ValueError):
        await storage.put("k", io.BytesIO(b"abc"), content_type="text/plain", sha256="0" * 64, size=3)
    with pytest.raises(ValueError):
        await storage.put("k", io.BytesIO(b"abc"), content_type="text/plain",
                          sha256=hashlib.sha256(b"abc").hexdigest(), size=4)
    assert await storage.exists("k") is False


async def test_unreachable_endpoint_is_reported_as_unavailable():
    storage = make_storage(endpoint_url="http://127.0.0.1:1")
    with pytest.raises(StorageUnavailable):
        await storage.exists("k")
    with pytest.raises(StorageUnavailable):
        await storage.put("k", io.BytesIO(b"x"), content_type="text/plain",
                          sha256=hashlib.sha256(b"x").hexdigest(), size=1)


def test_get_storage_requires_endpoint_and_both_keys(monkeypatch):
    from pydantic import SecretStr

    monkeypatch.setattr(storage_module.settings, "S3_ENDPOINT_URL", "http://seaweedfs:8333")
    monkeypatch.setattr(storage_module.settings, "S3_ACCESS_KEY", SecretStr("a"))
    monkeypatch.setattr(storage_module.settings, "S3_SECRET_KEY", None)
    with pytest.raises(HTTPException) as error:
        get_storage()
    assert error.value.status_code == 503
    assert error.value.detail == "Almacenamiento no configurado"

    monkeypatch.setattr(storage_module.settings, "S3_SECRET_KEY", SecretStr("s"))
    assert isinstance(get_storage(), S3Storage)
