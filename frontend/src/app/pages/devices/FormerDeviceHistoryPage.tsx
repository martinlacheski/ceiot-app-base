import { useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { deviceHistoryApi } from "@/api/deviceHistory.api";
import { PageHeader } from "@/app/components/PageHeader";
import { HistoryTelemetryTab } from "@/app/components/devices/HistoryTelemetryTab";
import { HistoryOperationsTab } from "@/app/components/devices/HistoryOperationsTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function FormerDeviceHistoryPage() {
  const { serial = "" } = useParams();
  const [url] = useSearchParams();
  const environmentId = url.get("environmentId") || url.get("environment_id") || "";
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // The list entry carries the name the device had in this establishment (live or snapshot).
  const entry = useQuery({
    queryKey: ["device-history-entry", serial, environmentId],
    enabled: Boolean(serial && environmentId),
    queryFn: async () => (await deviceHistoryApi.devices({ environmentId, search: serial, onlyFormer: false, perPage: 100 }))
      .items.find((item) => item.serial === serial && item.environmentId === environmentId) ?? null,
  });
  const deviceName = entry.data?.deviceName;
  const dateSelector = <div className="flex flex-wrap items-center gap-2"><Label htmlFor="history-date-from">Desde</Label><Input id="history-date-from" aria-label="Fecha desde" type="date" className="w-auto" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /><Label htmlFor="history-date-to">Hasta</Label><Input id="history-date-to" aria-label="Fecha hasta" type="date" className="w-auto" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></div>;
  return <PageHeader title={deviceName ? `Historial: ${deviceName} (${serial})` : `Historial: ${serial}`} subtitle="Actividad registrada mientras el dispositivo perteneció al establecimiento" backUrl="/app/devices/history">
    {!environmentId ? <p role="alert" className="text-destructive">Falta el establecimiento del historial. Vuelve al listado y selecciona el dispositivo.</p> :
      <Tabs defaultValue="telemetry"><TabsList><TabsTrigger value="telemetry">Telemetría</TabsTrigger><TabsTrigger value="operations">Operaciones</TabsTrigger></TabsList>
        <TabsContent value="telemetry" forceMount className="data-[state=inactive]:hidden"><HistoryTelemetryTab serial={serial} environmentId={environmentId} dateFrom={dateFrom} dateTo={dateTo} dateSelector={dateSelector} /></TabsContent>
        <TabsContent value="operations" forceMount className="data-[state=inactive]:hidden"><HistoryOperationsTab serial={serial} environmentId={environmentId} dateFrom={dateFrom} dateTo={dateTo} dateSelector={dateSelector} /></TabsContent>
      </Tabs>}
  </PageHeader>;
}
