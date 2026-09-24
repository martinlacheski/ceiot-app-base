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
