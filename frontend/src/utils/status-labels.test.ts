import { describe, expect, it } from "vitest";

import {
  getDeviceStatusLabel,
  getOperationTypeLabel,
  getOperationStatusLabel,
  getInvitationStatusLabel,
  getConnectionStatusLabel,
  getBooleanLabel,
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
    expect(getOperationTypeLabel("SENSOR_DATA")).toBe("Datos de sensores");
    expect(getOperationTypeLabel("KEEP_ACTIVE")).toBe("Dispositivo activo");
    expect(getOperationStatusLabel("success")).toBe("Exitoso");
    expect(getInvitationStatusLabel("pending")).toBe("Pendiente");
    expect(getConnectionStatusLabel("offline")).toBe("Fuera de línea");
  });

  it("labels nullable booleans without losing false", () => {
    expect(getBooleanLabel(true)).toBe("Sí");
    expect(getBooleanLabel(false)).toBe("No");
    expect(getBooleanLabel(null)).toBe("-");
  });
});
