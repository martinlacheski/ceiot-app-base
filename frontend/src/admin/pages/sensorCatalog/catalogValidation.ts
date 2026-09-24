import type { SensorVariableInput } from "./catalogApi";

export const SLUG_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

export function validateSensorVariables(rows: SensorVariableInput[]): string | null {
  if (!rows.length) return "Agrega al menos una variable.";
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.variableId) return "Selecciona una variable en cada fila.";
    if (seen.has(row.variableId)) return "Una variable no puede repetirse.";
    seen.add(row.variableId);
    if (row.minValue === "" || row.maxValue === "") return "Completa el mínimo y el máximo.";
    if (!Number.isFinite(row.minValue) || !Number.isFinite(row.maxValue) || row.minValue > row.maxValue) {
      return "El mínimo debe ser menor o igual al máximo.";
    }
    if (!row.accuracy.trim() || !row.resolution.trim()) return "Completa precisión y resolución.";
  }
  return null;
}
