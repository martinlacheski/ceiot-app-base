export function resolveDeviceEditPath(
  mode: "admin" | "user",
  deviceId: string,
) {
  return mode === "admin"
    ? `/admin/devices/${deviceId}/edit`
    : `/app/devices/${deviceId}/edit`;
}
