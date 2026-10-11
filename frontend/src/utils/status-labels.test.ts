import { describe, expect, it } from "vitest";

import {
  getDeviceStatusLabel,
  getOperationTypeLabel,
  getOperationStatusLabel,
  getInvitationStatusLabel,
  getConnectionStatusLabel,
  getBooleanLabel,
  getFirmwareUpdateStateLabel,
  OPERATION_TYPE_OPTIONS,
  humanizeCode,
  labelFrom,
} from "./status-labels";

describe("status labels", () => {
  it("normalizes known codes without exposing inherited properties", () => {
    const label = labelFrom({ active: "Activo" });
    expect(label(" ACTIVE ")).toBe("Activo");
    expect(label("constructor")).toBe("Constructor");
    expect(label("__proto__")).toBe("Proto");
    expect(label(42)).toBe("42");
    expect(label(null)).toBe("");
  });

  it("humanizes unknown codes instead of leaking uppercase or underscores", () => {
    expect(humanizeCode("weird_state")).toBe("Weird state");
    expect(humanizeCode("SENSOR_DATA")).toBe("Sensor data");
  });

  it("uses this project's backend vocabularies", () => {
    expect(getDeviceStatusLabel("paired")).toBe("VINCULADO");
    expect(getOperationTypeLabel("sensor_data")).toBe("Datos de sensores");
    expect(getOperationTypeLabel("keep_active")).toBe("Dispositivo activo");
    // Legacy uppercase codes still render the same label.
    expect(getOperationTypeLabel("SENSOR_DATA")).toBe("Datos de sensores");
    expect(getOperationStatusLabel("success")).toBe("Exitoso");
    expect(getInvitationStatusLabel("pending")).toBe("Pendiente");
    expect(getConnectionStatusLabel("offline")).toBe("Fuera de línea");
  });

  it("labels firmware updates and every attempt state", () => {
    expect(getOperationTypeLabel("firmware_update")).toBe("Actualización de firmware");
    expect(OPERATION_TYPE_OPTIONS).toContainEqual({ value: "firmware_update", label: "Actualización de firmware" });
    expect(getFirmwareUpdateStateLabel("requested")).toBe("Solicitada");
    expect(getFirmwareUpdateStateLabel("downloading")).toBe("Descargando");
    expect(getFirmwareUpdateStateLabel("succeeded")).toBe("Completada");
    expect(getFirmwareUpdateStateLabel("rolled_back")).toBe("Revertida");
    expect(getFirmwareUpdateStateLabel("rejected")).toBe("Rechazada");
  });

  it("labels the operations that record a device leaving an establishment", () => {
    expect(getOperationTypeLabel("unpair")).toBe("Desvinculación");
    expect(getOperationTypeLabel("move")).toBe("Traslado");
    expect(OPERATION_TYPE_OPTIONS).toContainEqual({ value: "unpair", label: "Desvinculación" });
    expect(OPERATION_TYPE_OPTIONS).toContainEqual({ value: "move", label: "Traslado" });
  });

  it("offers every operation type filter as a lowercase snake_case API value", () => {
    expect(OPERATION_TYPE_OPTIONS.map((option) => option.value)).toEqual([
      "sensor_data",
      "keep_active",
      "session_request",
      "error",
      "other",
      "firmware_update",
      "unpair",
      "move",
    ]);
    for (const option of OPERATION_TYPE_OPTIONS) {
      expect(option.label).toBe(getOperationTypeLabel(option.value));
    }
  });

  it("labels nullable booleans without losing false", () => {
    expect(getBooleanLabel(true)).toBe("Sí");
    expect(getBooleanLabel(false)).toBe("No");
    expect(getBooleanLabel(null)).toBe("-");
  });
});
