"""Admin-only firmware catalog endpoints: upload (multipart), list, page, activate/deactivate."""

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.device.firmware.models import FirmwareRelease
from app.core.config import settings
from app.core.storage import get_storage
from app.main import app
from tests.api.device.firmware.support import URL, auth, esp_image, sha256_of, upload


def test_an_admin_uploads_an_image_that_is_stored_and_registered(
    client: TestClient, session: Session, admin_user, storage
):
    data = esp_image(8192)

    response = upload(client, admin_user, data=data)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["version"] == "1.2.0"
    assert body["size"] == 8192
    assert body["sha256"] == sha256_of(data)
    assert body["active"] is True
    assert body["notes"] == "first"
    assert body["deactivatedPrevious"] == 0
    assert "storageKey" not in body  # an internal detail the UI never needs
    row = session.exec(select(FirmwareRelease)).one()
    assert row.created_by == admin_user.id
    assert storage.objects[row.storage_key] == data


def test_the_version_is_read_from_the_image(client: TestClient, admin_user, storage):
    response = upload(client, admin_user, data=esp_image(4096, version="2.0.1"))

    assert response.status_code == 201, response.text
    assert response.json()["version"] == "2.0.1"


def test_a_typed_version_that_matches_the_image_is_accepted(client: TestClient, admin_user, storage):
    response = client.post(
        f"{URL}/releases",
        headers=auth(admin_user),
        data={"version": " 2.0.1 "},
        files={"file": ("x.bin", esp_image(version="2.0.1"), "application/octet-stream")},
    )

    assert response.status_code == 201, response.text


def test_a_version_that_contradicts_the_image_is_rejected(client: TestClient, admin_user, storage):
    response = client.post(
        f"{URL}/releases",
        headers=auth(admin_user),
        data={"version": "9.9.9"},
        files={"file": ("x.bin", esp_image(version="2.0.1"), "application/octet-stream")},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "La versión no coincide con la del archivo (2.0.1)"
    assert storage.objects == {}


def test_an_image_of_another_project_is_rejected(client: TestClient, session: Session, admin_user, storage):
    response = upload(client, admin_user, data=esp_image(project="other_project"))

    assert response.status_code == 422
    assert "iot_device" in response.json()["detail"]
    assert storage.objects == {}
    assert session.exec(select(FirmwareRelease)).all() == []


def test_only_an_admin_may_upload(client: TestClient, test_user, storage):
    response = upload(client, test_user)

    assert response.status_code == 403
    assert storage.objects == {}


def test_a_file_that_is_not_an_esp_image_is_rejected_and_nothing_is_stored(
    client: TestClient, session: Session, admin_user, storage
):
    response = upload(client, admin_user, data=esp_image(2048, first_byte=0x00))

    assert response.status_code == 422
    assert storage.objects == {}
    assert session.exec(select(FirmwareRelease)).all() == []


def test_an_image_larger_than_the_ota_partition_is_rejected(client: TestClient, admin_user, storage):
    response = upload(client, admin_user, data=esp_image(0x400001))

    assert response.status_code == 422
    assert storage.objects == {}


def test_an_image_without_the_app_descriptor_is_rejected(client: TestClient, admin_user, storage):
    response = upload(client, admin_user, data=esp_image(4096, magic=0))

    assert response.status_code == 422
    assert "descriptor" in response.json()["detail"]
    assert storage.objects == {}


def test_a_version_can_be_uploaded_only_once(client: TestClient, admin_user, storage):
    assert upload(client, admin_user).status_code == 201

    again = upload(client, admin_user, data=esp_image(5000))

    assert again.status_code == 409
    assert len(storage.objects) == 1


def test_missing_object_storage_answers_503(client: TestClient, session: Session, admin_user, monkeypatch):
    app.dependency_overrides.pop(get_storage, None)
    monkeypatch.setattr(settings, "S3_ENDPOINT_URL", None)

    response = upload(client, admin_user)

    assert response.status_code == 503
    assert session.exec(select(FirmwareRelease)).all() == []


def test_releases_are_listed_newest_first_and_can_be_filtered(client: TestClient, admin_user, storage):
    upload(client, admin_user, version="1.0.0")
    upload(client, admin_user, version="1.1.0", deactivate_previous="false")

    rows = client.get(f"{URL}/releases", headers=auth(admin_user)).json()

    assert [row["version"] for row in rows] == ["1.1.0", "1.0.0"]
    only = client.get(f"{URL}/releases", params={"active": "true"}, headers=auth(admin_user))
    assert len(only.json()) == 2


def test_only_an_admin_may_list_releases(client: TestClient, test_user):
    assert client.get(f"{URL}/releases", headers=auth(test_user)).status_code == 403


def test_a_release_can_be_deactivated_and_reactivated(client: TestClient, admin_user, storage):
    release = upload(client, admin_user).json()

    off = client.post(f"{URL}/releases/{release['id']}/deactivate", headers=auth(admin_user))
    assert off.status_code == 200 and off.json()["active"] is False
    listed = client.get(f"{URL}/releases", params={"active": "true"}, headers=auth(admin_user))
    assert listed.json() == []
    on = client.post(f"{URL}/releases/{release['id']}/activate", headers=auth(admin_user))
    assert on.json()["active"] is True


def test_deactivating_is_admin_only_and_404_for_an_unknown_release(
    client: TestClient, admin_user, test_user, storage
):
    release = upload(client, admin_user).json()

    assert client.post(f"{URL}/releases/{release['id']}/deactivate", headers=auth(test_user)).status_code == 403
    unknown = client.post(
        f"{URL}/releases/00000000-0000-0000-0000-000000000000/deactivate", headers=auth(admin_user)
    )
    assert unknown.status_code == 404


def test_uploading_deactivates_the_previous_active_releases_by_default(
    client: TestClient, session: Session, admin_user, storage
):
    upload(client, admin_user, version="1.0.0")
    upload(client, admin_user, version="1.1.0", deactivate_previous="false")

    new = upload(client, admin_user, version="1.2.0")

    assert new.status_code == 201, new.text
    assert new.json()["active"] is True
    assert new.json()["deactivatedPrevious"] == 2
    session.expire_all()
    active = {row.version for row in session.exec(select(FirmwareRelease)).all() if row.active}
    assert active == {"1.2.0"}


def test_deactivate_previous_false_keeps_the_other_releases_active(
    client: TestClient, session: Session, admin_user, storage
):
    upload(client, admin_user, version="1.0.0")

    new = upload(client, admin_user, version="1.1.0", deactivate_previous="false")

    assert new.json()["deactivatedPrevious"] == 0
    session.expire_all()
    assert all(row.active for row in session.exec(select(FirmwareRelease)).all())


def _page(client: TestClient, admin_user, **params):
    response = client.get(f"{URL}/releases/page", params=params, headers=auth(admin_user))
    assert response.status_code == 200, response.text
    return response.json()


def _seed_catalog(client: TestClient, admin_user):
    upload(client, admin_user, version="1.0.0", notes="primera")
    upload(client, admin_user, version="1.1.0", notes="remoto", deactivate_previous="false")
    upload(client, admin_user, version="2.0.0", notes=None, deactivate_previous="false")
    upload(client, admin_user, version="3.0.0", notes="estable", deactivate_previous="false")


def test_the_page_endpoint_paginates_and_reports_totals(client: TestClient, admin_user, storage):
    _seed_catalog(client, admin_user)

    body = _page(client, admin_user, page=1, per_page=3)

    assert (body["total"], body["pages"], body["page"], body["perPage"]) == (4, 2, 1, 3)
    assert len(body["items"]) == 3
    assert len(_page(client, admin_user, page=2, per_page=3)["items"]) == 1


def test_the_page_endpoint_searches_version_and_notes(client: TestClient, admin_user, storage):
    _seed_catalog(client, admin_user)

    by_version = _page(client, admin_user, search="2.0")
    by_notes = _page(client, admin_user, search="ESTABLE")

    assert [row["version"] for row in by_version["items"]] == ["2.0.0"]
    assert [row["version"] for row in by_notes["items"]] == ["3.0.0"]


def test_the_page_endpoint_filters_by_active(client: TestClient, admin_user, storage):
    _seed_catalog(client, admin_user)
    first = _page(client, admin_user, search="1.0.0")["items"][0]
    client.post(f"{URL}/releases/{first['id']}/deactivate", headers=auth(admin_user))

    inactive = _page(client, admin_user, active="false")

    assert [row["version"] for row in inactive["items"]] == ["1.0.0"]


def test_the_page_endpoint_sorts_by_version_and_defaults_to_newest_first(
    client: TestClient, admin_user, storage
):
    _seed_catalog(client, admin_user)

    default = [row["version"] for row in _page(client, admin_user)["items"]]
    ascending = [row["version"] for row in _page(client, admin_user, sort="version:asc")["items"]]
    descending = [row["version"] for row in _page(client, admin_user, sort="version:desc")["items"]]

    assert default[0] == "3.0.0"
    assert ascending == ["1.0.0", "1.1.0", "2.0.0", "3.0.0"]
    assert descending == list(reversed(ascending))


def test_an_unknown_sort_field_is_rejected(client: TestClient, admin_user, storage):
    response = client.get(f"{URL}/releases/page", params={"sort": "sha256:asc"}, headers=auth(admin_user))

    assert response.status_code == 422


def test_only_an_admin_may_use_the_page_endpoint(client: TestClient, test_user):
    assert client.get(f"{URL}/releases/page", headers=auth(test_user)).status_code == 403
