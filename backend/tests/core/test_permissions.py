"""The `sensor:read` permission was removed: C10 (the only endpoint that ever
checked it) is gone since S6, and nothing else in the codebase references it
(see 0009_remove_sensor_read_permission.py)."""

from app.core.permissions import ALL_PERMISSIONS, BASIC_PERMISSIONS, PERMISSIONS_TREE


def test_sensor_read_permission_is_gone_from_all_permissions():
    assert "sensor:read" not in ALL_PERMISSIONS


def test_sensor_read_permission_is_gone_from_basic_permissions():
    assert "sensor:read" not in BASIC_PERMISSIONS


def test_sensors_group_is_gone_from_the_permission_tree():
    assert "SENSORS" not in PERMISSIONS_TREE
    for group in PERMISSIONS_TREE.values():
        assert all(item["value"] != "sensor:read" for item in group["items"])


LEGACY_INVITATION_CODES = {"invitation:read", "invitation:create", "invitation:delete"}


def test_legacy_invitation_permissions_are_gone():
    """Retired with ``environmentinvitation`` (0023); scoped access uses ``access:*``."""
    assert "INVITATIONS" not in PERMISSIONS_TREE
    assert LEGACY_INVITATION_CODES.isdisjoint(ALL_PERMISSIONS)
    assert LEGACY_INVITATION_CODES.isdisjoint(BASIC_PERMISSIONS)


def _tree_labels() -> list[str]:
    labels = []
    for group in PERMISSIONS_TREE.values():
        labels.append(group["label"])
        labels.extend(item["label"] for item in group["items"])
    return labels


def _tree_values() -> set[str]:
    return {item["value"] for group in PERMISSIONS_TREE.values() for item in group["items"]}


def test_every_basic_permission_is_shown_in_the_permission_tree():
    """The admin user form renders the tree, so a hidden basic code is never visible."""
    missing = set(BASIC_PERMISSIONS) - _tree_values()
    assert missing == set()


def test_basic_permissions_are_a_subset_of_all_permissions():
    assert set(BASIC_PERMISSIONS) <= set(ALL_PERMISSIONS)


def test_environment_types_group_follows_environments():
    keys = list(PERMISSIONS_TREE)
    assert keys[keys.index("ENVIRONMENTS") + 1] == "ENVIRONMENT_TYPES"


def test_permission_tree_labels_are_spanish():
    english_words = ("View", "Manage", "Access", "Environmental")
    offenders = [
        label for label in _tree_labels() if any(word in label for word in english_words)
    ]
    assert offenders == []


def test_access_labels_no_longer_mention_the_retired_commission():
    assert all("comisión" not in label.lower() for label in _tree_labels())


def test_sensor_and_access_groups_use_the_expected_spanish_labels():
    sensors = PERMISSIONS_TREE["SENSOR_CATALOG"]
    assert sensors["label"] == "Sensores ambientales"
    assert {item["value"]: item["label"] for item in sensors["items"]} == {
        "sensor_catalog:read": "Ver catálogo de sensores",
        "sensor_catalog:write": "Gestionar catálogo de sensores",
        "device_sensor:read": "Ver sensores de dispositivos",
        "device_sensor:write": "Gestionar sensores de dispositivos",
        "telemetry:read": "Ver telemetría",
    }

    access = PERMISSIONS_TREE["ACCESS"]
    assert access["label"] == "Accesos compartidos"
    assert {item["value"]: item["label"] for item in access["items"]} == {
        "access:read": "Ver accesos compartidos",
        "access:manage": "Gestionar invitados",
    }
