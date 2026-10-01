"""Admin-only documents API: upload validation, dedupe, list, download, edit, delete."""

import hashlib
import uuid

import pytest

from app.api.document import constants

BASE = "/api/documents"
PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n"
DOCX = b"PK\x03\x04" + b"\x00" * 32


def upload(client, headers, name="notes.txt", data=b"hello world", title=None, content_type="text/plain"):
    return client.post(
        BASE,
        headers=headers,
        files={"file": (name, data, content_type)},
        data={"title": title} if title is not None else None,
    )


def test_every_endpoint_requires_an_administrator(client, storage, user_headers):
    doc_id = uuid.uuid4()
    calls = [
        ("post", BASE, {"files": {"file": ("a.txt", b"x", "text/plain")}}),
        ("get", BASE, {}),
        ("get", f"{BASE}/{doc_id}", {}),
        ("get", f"{BASE}/{doc_id}/download", {}),
        ("patch", f"{BASE}/{doc_id}", {"json": {"title": "x"}}),
        ("delete", f"{BASE}/{doc_id}", {}),
    ]
    for method, url, kwargs in calls:
        assert getattr(client, method)(url, **kwargs).status_code == 401, (method, url)
        denied = getattr(client, method)(url, headers=user_headers, **kwargs)
        assert denied.status_code == 403, (method, url)


def test_upload_stores_object_and_returns_metadata(client, storage, admin_headers, admin_user):
    response = upload(client, admin_headers, "Manual de campo.txt", b"hello world")
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["title"] == "Manual de campo"
    assert body["filename"] == "Manual de campo.txt"
    assert body["contentType"] == "text/plain"
    assert body["sizeBytes"] == 11
    assert body["sha256"] == hashlib.sha256(b"hello world").hexdigest()
    assert body["ingestionStatus"] == "pending"
    assert body["ingestedAt"] is None and body["error"] is None
    assert body["isActive"] is True
    assert body["uploadedBy"] == str(admin_user.id)
    assert "storageKey" not in body
    assert list(storage.objects.values()) == [b"hello world"]


def test_upload_accepts_pdf_md_docx_and_explicit_title(client, storage, admin_headers):
    assert upload(client, admin_headers, "a.pdf", PDF, "Guia", "application/octet-stream").status_code == 201
    md = upload(client, admin_headers, "b.md", b"# Titulo\n", None, "text/markdown")
    assert md.status_code == 201 and md.json()["contentType"] == "text/markdown"
    docx = upload(client, admin_headers, "c.docx", DOCX, "Informe")
    assert docx.status_code == 201
    assert docx.json()["title"] == "Informe"
    assert docx.json()["contentType"].endswith("wordprocessingml.document")
    pdf = client.get(BASE, headers=admin_headers, params={"search": "guia"}).json()["items"][0]
    assert pdf["contentType"] == "application/pdf"


def test_upload_rejects_unsupported_or_mismatched_content(client, storage, admin_headers):
    assert upload(client, admin_headers, "x.exe", b"MZ\x90").status_code == 415
    assert upload(client, admin_headers, "noext", b"hello").status_code == 415
    assert upload(client, admin_headers, "fake.pdf", b"just text").status_code == 415
    assert upload(client, admin_headers, "fake.docx", b"just text").status_code == 415
    assert upload(client, admin_headers, "bin.txt", b"abc\x00def").status_code == 415
    assert upload(client, admin_headers, "latin.txt", b"\xff\xfe\xfa").status_code == 415
    assert storage.objects == {}


def test_upload_rejects_empty_and_oversized_files(client, storage, admin_headers, monkeypatch):
    assert upload(client, admin_headers, "empty.txt", b"").status_code == 422
    monkeypatch.setattr(constants, "MAX_DOCUMENT_BYTES", 10)
    assert upload(client, admin_headers, "ok.txt", b"1234567890").status_code == 201
    too_big = upload(client, admin_headers, "big.txt", b"12345678901")
    assert too_big.status_code == 413
    assert len(storage.objects) == 1


def test_upload_dedupes_by_sha256(client, storage, admin_headers):
    first = upload(client, admin_headers, "one.txt", b"same bytes")
    assert first.status_code == 201
    dup = upload(client, admin_headers, "two.txt", b"same bytes")
    assert dup.status_code == 409
    assert len(storage.objects) == 1


def test_upload_sanitizes_the_filename(client, storage, admin_headers):
    body = upload(client, admin_headers, "../../etc/pass wd‮.txt", b"data").json()
    assert "/" not in body["filename"] and "‮" not in body["filename"]
    assert all(".." not in key for key in storage.objects)


def test_upload_without_configured_storage_is_503(client, admin_headers, monkeypatch):
    from app.core import storage as storage_module

    monkeypatch.setattr(storage_module.settings, "S3_ACCESS_KEY", None)
    monkeypatch.setattr(storage_module.settings, "S3_SECRET_KEY", None)
    response = upload(client, admin_headers)
    assert response.status_code == 503
    assert response.json()["detail"] == "Almacenamiento no configurado"


def test_upload_storage_outage_is_503_and_leaves_no_row(client, storage, admin_headers):
    storage.fail = True
    assert upload(client, admin_headers).status_code == 503
    storage.fail = False
    assert client.get(BASE, headers=admin_headers).json()["total"] == 0


def test_listing_without_storage_still_works(client, admin_headers, monkeypatch):
    from app.core import storage as storage_module

    monkeypatch.setattr(storage_module.settings, "S3_ACCESS_KEY", None)
    assert client.get(BASE, headers=admin_headers).status_code == 200


def test_list_search_filters_sort_and_pagination(client, storage, admin_headers):
    upload(client, admin_headers, "alpha.txt", b"aaa", "Alpha")
    upload(client, admin_headers, "beta.pdf", PDF, "Beta")
    upload(client, admin_headers, "gamma.md", b"# gamma", "Gamma 100%")

    page = client.get(BASE, headers=admin_headers).json()
    assert page["total"] == 3 and page["page"] == 1 and page["perPage"] == 10 and page["pages"] == 1

    assert [i["title"] for i in client.get(BASE, headers=admin_headers, params={"search": "ALP"}).json()["items"]] == ["Alpha"]
    assert client.get(BASE, headers=admin_headers, params={"search": "beta.pdf"}).json()["total"] == 1
    # LIKE wildcards are literal.
    assert client.get(BASE, headers=admin_headers, params={"search": "%"}).json()["total"] == 1
    assert client.get(BASE, headers=admin_headers, params={"file_type": "pdf"}).json()["total"] == 1
    assert client.get(BASE, headers=admin_headers, params={"file_type": "txt"}).json()["items"][0]["title"] == "Alpha"
    assert client.get(BASE, headers=admin_headers, params={"ingestion_status": "ready"}).json()["total"] == 0
    assert client.get(BASE, headers=admin_headers, params={"ingestion_status": "pending"}).json()["total"] == 3
    assert client.get(BASE, headers=admin_headers, params={"is_active": False}).json()["total"] == 0

    by_title = client.get(BASE, headers=admin_headers, params={"sort": "title:desc"}).json()["items"]
    assert [i["title"] for i in by_title] == ["Gamma 100%", "Beta", "Alpha"]
    by_size = client.get(BASE, headers=admin_headers, params={"sort": "sizeBytes:asc"}).json()["items"]
    assert by_size[0]["title"] == "Alpha" or by_size[0]["sizeBytes"] <= by_size[-1]["sizeBytes"]

    first = client.get(BASE, headers=admin_headers, params={"per_page": 2, "sort": "title:asc"}).json()
    assert [i["title"] for i in first["items"]] == ["Alpha", "Beta"] and first["pages"] == 2
    second = client.get(BASE, headers=admin_headers, params={"per_page": 2, "page": 2, "sort": "title:asc"}).json()
    assert [i["title"] for i in second["items"]] == ["Gamma 100%"]


def test_list_rejects_bad_parameters(client, storage, admin_headers):
    assert client.get(BASE, headers=admin_headers, params={"sort": "nope:asc"}).status_code == 422
    assert client.get(BASE, headers=admin_headers, params={"file_type": "exe"}).status_code == 422
    assert client.get(BASE, headers=admin_headers, params={"ingestion_status": "x"}).status_code == 422
    assert client.get(BASE, headers=admin_headers, params={"per_page": 101}).status_code == 422
    assert client.get(BASE, headers=admin_headers, params={"page": 0}).status_code == 422


def test_get_and_download_stream_the_stored_bytes(client, storage, admin_headers):
    created = upload(client, admin_headers, "Informe año.txt", b"contenido largo de prueba").json()
    detail = client.get(f"{BASE}/{created['id']}", headers=admin_headers)
    assert detail.status_code == 200 and detail.json()["sha256"] == created["sha256"]

    download = client.get(f"{BASE}/{created['id']}/download", headers=admin_headers)
    assert download.status_code == 200
    assert download.content == b"contenido largo de prueba"
    assert hashlib.sha256(download.content).hexdigest() == created["sha256"]
    assert download.headers["content-type"].startswith("text/plain")
    assert download.headers["x-content-type-options"] == "nosniff"
    disposition = download.headers["content-disposition"]
    assert disposition.startswith("attachment;") and "filename*=UTF-8''Informe%20a%C3%B1o.txt" in disposition

    assert client.get(f"{BASE}/{uuid.uuid4()}", headers=admin_headers).status_code == 404
    assert client.get(f"{BASE}/{uuid.uuid4()}/download", headers=admin_headers).status_code == 404


def test_download_with_missing_object_is_404(client, storage, admin_headers):
    created = upload(client, admin_headers).json()
    storage.objects.clear()
    response = client.get(f"{BASE}/{created['id']}/download", headers=admin_headers)
    assert response.status_code == 404


def test_patch_title_and_active_flag(client, storage, admin_headers):
    created = upload(client, admin_headers).json()
    url = f"{BASE}/{created['id']}"
    edited = client.patch(url, headers=admin_headers, json={"title": "  Nuevo titulo  "})
    assert edited.status_code == 200 and edited.json()["title"] == "Nuevo titulo"
    assert client.patch(url, headers=admin_headers, json={"isActive": False}).json()["isActive"] is False
    assert client.get(BASE, headers=admin_headers, params={"is_active": False}).json()["total"] == 1
    assert client.patch(url, headers=admin_headers, json={"title": "   "}).status_code == 422
    assert client.patch(url, headers=admin_headers, json={"title": "x" * 256}).status_code == 422
    assert client.patch(url, headers=admin_headers, json={"title": None}).status_code == 422
    # Storage and integrity fields are not editable.
    ignored = client.patch(url, headers=admin_headers, json={"sha256": "0" * 64, "ingestionStatus": "ready"})
    assert ignored.json()["sha256"] == created["sha256"] and ignored.json()["ingestionStatus"] == "pending"
    assert client.patch(f"{BASE}/{uuid.uuid4()}", headers=admin_headers, json={"title": "x"}).status_code == 404


def test_delete_removes_object_and_row_and_frees_the_hash(client, storage, admin_headers):
    created = upload(client, admin_headers, "a.txt", b"payload").json()
    url = f"{BASE}/{created['id']}"
    assert client.delete(url, headers=admin_headers).status_code == 204
    assert storage.objects == {}
    assert client.get(url, headers=admin_headers).status_code == 404
    assert client.delete(url, headers=admin_headers).status_code == 404
    assert upload(client, admin_headers, "a.txt", b"payload").status_code == 201


def test_delete_keeps_the_row_when_storage_fails(client, storage, admin_headers):
    created = upload(client, admin_headers).json()
    storage.fail = True
    assert client.delete(f"{BASE}/{created['id']}", headers=admin_headers).status_code == 503
    storage.fail = False
    assert client.get(f"{BASE}/{created['id']}", headers=admin_headers).status_code == 200
    assert len(storage.objects) == 1


def test_table_has_unique_hash_and_ingestion_defaults(session):
    from sqlalchemy import inspect

    inspector = inspect(session.get_bind())
    assert "document" in inspector.get_table_names()
    columns = {c["name"] for c in inspector.get_columns("document")}
    assert {"id", "title", "filename", "content_type", "size_bytes", "sha256", "storage_key",
            "uploaded_by", "created_at", "updated_at", "is_active", "ingestion_status",
            "ingested_at", "error"} <= columns
    uniques = [i for i in inspector.get_indexes("document") if i.get("unique")]
    assert any(i["column_names"] == ["sha256"] for i in uniques)
