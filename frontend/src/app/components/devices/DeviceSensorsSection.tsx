import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Plus, Trash2 } from "lucide-react";

import { environmentalSensorService } from "@/app/services/environmentalSensor.service";
import { useAuthStore } from "@/auth/store/auth.store";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CenteredHeader } from "@/components/custom/CenteredHeader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { showConfirmDialog } from "@/store/confirm.store";
import { getSensorInstallationStatusLabel } from "@/utils/status-labels";

interface DeviceSensorsSectionProps { deviceId: string; canManage: boolean }

const rangeFormatter = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

export function DeviceSensorsSection({ deviceId, canManage }: DeviceSensorsSectionProps) {
  const { user } = useAuthStore();
  const permissions = user?.permissions ?? [];
  const canRead = user?.isAdmin || permissions.includes("device_sensor:read");
  const canReadCatalog = user?.isAdmin || permissions.includes("sensor_catalog:read");
  const canWrite = canManage && (user?.isAdmin || permissions.includes("device_sensor:write"));
  const queryClient = useQueryClient();
  const [modelId, setModelId] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editConfig, setEditConfig] = useState("{}");
  const [error, setError] = useState("");
  const { data: catalog = [], isLoading: catalogLoading, isError: catalogError } = useQuery({ queryKey: ["sensor-catalog", "sensors"], queryFn: environmentalSensorService.getCatalog, enabled: Boolean(canReadCatalog) });
  const { data: installed = [], isLoading, isError } = useQuery({ queryKey: ["device-sensors", deviceId], queryFn: () => environmentalSensorService.getDeviceSensors(deviceId), enabled: Boolean(canRead && deviceId) });
  const invalidate = () => { queryClient.invalidateQueries({ queryKey: ["device-sensors", deviceId] }); setError(""); };
  const add = useMutation({ mutationFn: (payload: { sensorId: string; config: Record<string, unknown> }) => environmentalSensorService.addDeviceSensor(deviceId, payload), onSuccess: invalidate, onError: () => setError("No se pudo agregar el sensor.") });
  const update = useMutation({ mutationFn: ({ id, config }: { id: string; config: Record<string, unknown> }) => environmentalSensorService.updateDeviceSensor(deviceId, id, { config }), onSuccess: () => { invalidate(); setEditId(null); }, onError: () => setError("No se pudo actualizar la configuración del sensor.") });
  const remove = useMutation({ mutationFn: (id: string) => environmentalSensorService.removeDeviceSensor(deviceId, id), onSuccess: invalidate, onError: () => setError("No se pudo quitar el sensor.") });

  if (!canRead) return null;
  const addSensor = () => {
    if (!modelId) { setError("Selecciona un modelo de sensor."); return; }
    add.mutate({ sensorId: modelId, config: {} });
  };
  const saveEdit = () => {
    if (!editId) return;
    try {
      const config: unknown = JSON.parse(editConfig);
      if (!config || Array.isArray(config) || typeof config !== "object") throw new Error("invalid config");
      update.mutate({ id: editId, config: config as Record<string, unknown> });
    } catch { setError("La configuración debe ser un objeto JSON válido."); }
  };

  return <Card>
    <CardContent className="space-y-4 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">Sensores del dispositivo</h3>
        {canWrite && canReadCatalog && <Button type="button" className="min-h-11" onClick={addSensor} disabled={add.isPending || catalogLoading || catalogError}><Plus aria-hidden="true" />Agregar sensor</Button>}
      </div>
      {canWrite && canReadCatalog && <select aria-label="Modelo de sensor" className="min-h-11 w-full max-w-sm rounded-md border border-input bg-background px-3 text-sm" value={modelId} onChange={(event) => setModelId(event.target.value)} disabled={catalogLoading || catalogError}>
        <option value="">Seleccionar modelo</option>
        {catalog.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
      </select>}
      {isError ? <p role="alert" className="text-sm text-destructive">No se pudieron cargar los sensores.</p> : <Table className="min-w-[720px]">
        <TableHeader><TableRow><TableHead>Sensor</TableHead><TableHead>Variables</TableHead><TableHead>Instalado</TableHead><TableHead><CenteredHeader>Acciones</CenteredHeader></TableHead></TableRow></TableHeader>
        <TableBody>
          {isLoading || installed.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">{isLoading ? "Cargando sensores…" : "Todavía no agregaste sensores."}</TableCell></TableRow> : installed.map((sensor) => {
            const model = catalog.find((entry) => entry.id === sensor.sensorId);
            return <TableRow key={sensor.id}>
              <TableCell className="min-w-48 whitespace-normal align-top">
                <p className="font-medium">{model?.name ?? sensor.key}</p>
                <p className="text-xs text-muted-foreground">{getSensorInstallationStatusLabel(sensor.isActive ? "active" : "inactive")}</p>
                <p className="mt-1 text-xs font-medium text-muted-foreground">Identificador en telemetría</p>
                <p className="font-mono text-sm text-muted-foreground">{sensor.key}</p>
                <p className="text-xs text-muted-foreground">Es el nombre que usa el dispositivo en su telemetría.</p>
              </TableCell>
              <TableCell className="min-w-64 whitespace-normal text-xs text-muted-foreground">{model?.variables.length ? model.variables.map((variable) => `${variable.name} (${variable.unit}): ${rangeFormatter.format(variable.min)}–${rangeFormatter.format(variable.max)} ${variable.unit}`).join(" · ") : "—"}</TableCell>
              <TableCell className="whitespace-normal text-sm text-muted-foreground">{sensor.installedAt ? format(new Date(sensor.installedAt), "PP p", { locale: es }) : "—"}</TableCell>
              <TableCell className="text-center">{canWrite && sensor.isActive && <div className="flex justify-center gap-2">
                <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => { setEditId(sensor.id); setEditConfig(JSON.stringify(sensor.config, null, 2)); }}>Editar</Button>
                <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label="Quitar sensor" title="Quitar sensor" onClick={() => showConfirmDialog(`¿Deseas quitar el sensor ${sensor.key}? Sus lecturas anteriores se conservarán.`, async () => { await remove.mutateAsync(sensor.id); })}><Trash2 aria-hidden="true" /></Button>
              </div>}</TableCell>
            </TableRow>;
          })}
        </TableBody>
      </Table>}
      {editId && <div className="space-y-2 border-t pt-3">
        <label className="block text-sm">Configuración JSON<textarea className="min-h-20 w-full rounded-md border bg-background p-2 font-mono text-sm" value={editConfig} onChange={(event) => setEditConfig(event.target.value)} /></label>
        <div className="flex gap-2"><Button type="button" size="sm" className="min-h-11" onClick={saveEdit} disabled={update.isPending}>Guardar sensor</Button><Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => setEditId(null)}>Cancelar</Button></div>
      </div>}
      {catalogError && canReadCatalog && <p role="alert" className="text-sm text-destructive">No se pudo cargar el catálogo de sensores.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </CardContent>
  </Card>;
}
