from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.auth.models import User
from app.api.device.models import Device
from app.core.emqx_presence import PresenceSnapshot, get_emqx_presence_client
from app.core.security import create_access_token
from app.main import app
class SnapshotClient:
    def __init__(self, snapshot):
        self.snapshot = snapshot

    async def get_snapshot(self):
        return self.snapshot


def test_list_and_detail_report_live_presence_and_unavailable(
    client: TestClient, session: Session, test_user: User
):
    test_user.permissions = ["device:read_all"]
    session.add(test_user)
    session.commit()
    serials = ["IOT-0000-0011", "IOT-0000-0012"]
    devices = [
        Device(serial=serials[0], name="Presence online", broker_connected=False),
        Device(serial=serials[1], name="Presence offline", broker_connected=True),
    ]
    session.add_all(devices)
    session.commit()
    for item in devices:
        session.refresh(item)
    token, _ = create_access_token({"id": str(test_user.id)})
    headers = {"Authorization": f"Bearer {token}"}

    app.dependency_overrides[get_emqx_presence_client] = lambda: SnapshotClient(
        PresenceSnapshot.available_with({serials[0]})
    )
    response = client.get("/api/devices", params={"search": "Presence"}, headers=headers)
    assert response.status_code == 200
    observed = {
        item["serial"]: item["brokerConnected"]
        for item in response.json()["items"]
    }
    assert observed == {
        serials[0]: True,
        serials[1]: False,
    }

    detail = client.get(f"/api/devices/{devices[0].id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["brokerConnected"] is True

    app.dependency_overrides[get_emqx_presence_client] = lambda: SnapshotClient(
        PresenceSnapshot.unavailable()
    )
    unavailable = client.get(f"/api/devices/{devices[1].id}", headers=headers)
    assert unavailable.status_code == 200
    assert unavailable.json()["brokerConnected"] is None
    session.refresh(devices[0])
    session.refresh(devices[1])
    assert [item.broker_connected for item in devices] == [False, True]


def test_live_presence_sort_happens_before_pagination(
    client: TestClient, session: Session, test_user: User
):
    test_user.permissions = ["device:read_all"]
    session.add(test_user)
    session.commit()
    offline = Device(serial="IOT-0000-0021", name="Live sort target")
    online = Device(serial="IOT-0000-0022", name="Live sort target")
    session.add_all([offline, online])
    session.commit()
    token, _ = create_access_token({"id": str(test_user.id)})
    app.dependency_overrides[get_emqx_presence_client] = lambda: SnapshotClient(
        PresenceSnapshot.available_with({online.serial})
    )

    response = client.get(
        "/api/devices",
        params={"search": "Live sort target", "sort_by": "brokerConnected", "sort_order": "desc", "per_page": 1},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json()["total"] == 2
    assert response.json()["items"][0]["serial"] == online.serial
