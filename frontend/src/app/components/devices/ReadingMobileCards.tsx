import type { HistoryReading } from "@/api/deviceHistory.api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/utils/date.utils";
import { formatHistoryBoolean, formatHistoryReading } from "./readingFormat";
export function ReadingMobileCards({ readings }: { readings: HistoryReading[] }) {
  return <div className="grid gap-3 md:hidden" aria-label="Lecturas de telemetría en tarjetas">{readings.map((item) => <Card key={item.id} role="article"><CardHeader><CardTitle>{formatDateTime(item.time)}</CardTitle></CardHeader><CardContent className="space-y-1 text-sm"><p>Temperatura: {formatHistoryReading(item.temperatureC, "°C")}</p><p>Humedad: {formatHistoryReading(item.relativeHumidityPct, "%")}</p><p>Presión: {formatHistoryReading(item.pressureHpa, "hPa")}</p><p>Alimentación: {formatHistoryBoolean(item.powerSupplyState)}</p><p>Firmware: {item.firmwareVersion || "-"}</p><p>RSSI: {formatHistoryReading(item.wifiRssi, "dBm")}</p><p>Error: {item.lastError || "-"}</p></CardContent></Card>)}</div>;
}
