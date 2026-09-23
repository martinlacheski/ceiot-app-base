import { deviceHistoryApi, type HistoryReading } from "@/api/deviceHistory.api";
import { ListNumberFilter, ListSelectFilter, ListTextFilter } from "@/components/custom/ListFilterFields";
import { formatDateTime } from "@/utils/date.utils";
import { getBooleanLabel } from "@/utils/status-labels";
import { formatHistoryBoolean, formatHistoryReading } from "./readingFormat";
import { ReadingMobileCards } from "./ReadingMobileCards";
import { HistoryTabBase } from "./HistoryTabBase";
import type { ReactNode } from "react";
const number = (value?: string) => value === undefined || value === "" ? undefined : Number(value);
export function HistoryTelemetryTab({ serial, environmentId, dateFrom, dateTo, dateSelector }: { serial: string; environmentId: string; dateFrom?: string; dateTo?: string; dateSelector: ReactNode }) {
  return <HistoryTabBase<HistoryReading> kind="telemetry" serial={serial} environmentId={environmentId} dateFrom={dateFrom} dateTo={dateTo} dateSelector={dateSelector}
    fetchRows={({ filters, ...params }) => deviceHistoryApi.readings(serial, { ...params, environmentId, tempMin: number(filters.tempMin), tempMax: number(filters.tempMax), humidityMin: number(filters.humidityMin), humidityMax: number(filters.humidityMax), pressureMin: number(filters.pressureMin), pressureMax: number(filters.pressureMax), hasError: filters.hasError === undefined ? undefined : filters.hasError === "true", firmwareVersion: filters.firmwareVersion })}
    filterFields={(setFilter, filters) => <>
      {(["tempMin", "tempMax", "humidityMin", "humidityMax", "pressureMin", "pressureMax"] as const).map((key) => <ListNumberFilter key={key} label={({ tempMin: "Temperatura mín. °C", tempMax: "Temperatura máx. °C", humidityMin: "Humedad mín. %", humidityMax: "Humedad máx. %", pressureMin: "Presión mín. hPa", pressureMax: "Presión máx. hPa" })[key]} value={filters[key] || ""} onChange={(value) => setFilter(key, value)} />)}
      <ListSelectFilter label="Con error" value={filters.hasError} onChange={(value) => setFilter("hasError", value)} options={[{ value: "true", label: getBooleanLabel(true) }, { value: "false", label: getBooleanLabel(false) }]} />
      <ListTextFilter label="Firmware" value={filters.firmwareVersion || ""} onChange={(value) => setFilter("firmwareVersion", value)} />
    </>}
    columns={[
      { id: "time", title: "Fecha/Hora", value: (item) => formatDateTime(item.time), sortable: true },
      { id: "temperature_c", title: "Temperatura", value: (item) => formatHistoryReading(item.temperatureC, "°C"), sortable: true },
      { id: "relative_humidity_pct", title: "Humedad", value: (item) => formatHistoryReading(item.relativeHumidityPct, "%"), sortable: true },
      { id: "pressure_hpa", title: "Presión", value: (item) => formatHistoryReading(item.pressureHpa, "hPa"), sortable: true },
      { id: "power", title: "Alimentación", value: (item) => formatHistoryBoolean(item.powerSupplyState) },
      { id: "firmware_version", title: "Firmware", value: (item) => item.firmwareVersion || "-", sortable: true },
      { id: "wifi_rssi", title: "RSSI", value: (item) => formatHistoryReading(item.wifiRssi, "dBm"), sortable: true },
      { id: "error", title: "Error", value: (item) => item.lastError || "-" },
    ]}
    mobile={(rows) => <ReadingMobileCards readings={rows} />}
  />;
}
