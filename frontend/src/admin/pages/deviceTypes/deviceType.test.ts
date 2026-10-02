import { describe, expect, it } from "vitest";
import { buildPayload, parseConfigTemplate, validateDeviceTypeForm, type DeviceTypeFormValues, type DeviceTypeSensorRow } from "./deviceTypeValidation";

const values: DeviceTypeFormValues = { code: "weather_station", name: "Estación", hardwareModel: "ESP32", description: "", telemetryIntervalS: "60", offlineAfterS: "180", minSensors: "1", configTemplate: "{}" };
const rows: DeviceTypeSensorRow[] = [{ sensorId: "s1", required: false, maxCount: 2, includedByDefault: true }];
const check = (patch: Partial<DeviceTypeFormValues> = {}, nextRows = rows, creating = true) => validateDeviceTypeForm({ ...values, ...patch }, nextRows, { creating });

describe("device type validation", () => {
  it("accepts a valid type", () => expect(check()).toBeNull());
  it("requires a slug code only when creating", () => {
    expect(check({ code: "Bad Code" })).toBe("El código debe ser un identificador en minúsculas, sin espacios.");
    expect(check({ code: "" }, rows, false)).toBeNull();
  });
  it("requires a name", () => expect(check({ name: "  " })).toBe("Completa el nombre."));
  it("keeps telemetry and offline times inside their ranges and ordered", () => {
    expect(check({ telemetryIntervalS: "1" })).toBe("El intervalo de telemetría debe estar entre 5 y 86400 segundos.");
    expect(check({ offlineAfterS: "2" })).toBe("El tiempo sin conexión debe estar entre 10 y 604800 segundos.");
    expect(check({ telemetryIntervalS: "600", offlineAfterS: "300" })).toBe("El tiempo sin conexión no puede ser menor que el intervalo de telemetría.");
    expect(check({ telemetryIntervalS: "", offlineAfterS: "" })).toBeNull();
    expect(check({ telemetryIntervalS: "1.5" })).toBe("El intervalo de telemetría debe estar entre 5 y 86400 segundos.");
  });
  it("checks the minimum against the compatible capacity", () => {
    expect(check({ minSensors: "3" })).toBe("El mínimo de sensores supera la cantidad máxima de sensores compatibles.");
    expect(check({ minSensors: "-1" })).toBe("El mínimo de sensores debe ser un entero mayor o igual a 0.");
    expect(check({ minSensors: "1" }, [])).toBe("Para exigir sensores agrega al menos un sensor compatible.");
  });
  it("validates every compatible sensor row", () => {
    expect(check({ minSensors: "0" }, [{ ...rows[0], sensorId: "" }])).toBe("Selecciona un sensor en cada fila.");
    expect(check({ minSensors: "0" }, [rows[0], rows[0]])).toBe("Un sensor no puede repetirse.");
    expect(check({ minSensors: "0" }, [{ ...rows[0], maxCount: 0 }])).toBe("El máximo debe ser un entero mayor o igual a 1.");
    expect(check({ minSensors: "0" }, [{ ...rows[0], maxCount: "" }])).toBe("El máximo debe ser un entero mayor o igual a 1.");
  });
  it("accepts only a JSON object as configuration template", () => {
    expect(parseConfigTemplate("")).toEqual({ value: {} });
    expect(parseConfigTemplate('{"i2c": {"sda": 21}}')).toEqual({ value: { i2c: { sda: 21 } } });
    for (const bad of ["[1]", "null", "3", "{oops"]) expect(parseConfigTemplate(bad)).toEqual({ error: "La plantilla de configuración debe ser un objeto JSON válido." });
    expect(check({ configTemplate: "[]" })).toBe("La plantilla de configuración debe ser un objeto JSON válido.");
  });
  it("builds the API payload with nulls for blanks", () => {
    expect(buildPayload({ ...values, description: " ", hardwareModel: "", telemetryIntervalS: "", offlineAfterS: "180", configTemplate: '{"a":1}' }, rows, { creating: true })).toEqual({
      code: "weather_station", name: "Estación", description: null, hardwareModel: null, telemetryIntervalS: null, offlineAfterS: 180, minSensors: 1, configTemplate: { a: 1 },
      sensors: [{ sensorId: "s1", required: false, maxCount: 2, includedByDefault: true }],
    });
    expect("code" in buildPayload(values, rows, { creating: false })).toBe(false);
  });
});
