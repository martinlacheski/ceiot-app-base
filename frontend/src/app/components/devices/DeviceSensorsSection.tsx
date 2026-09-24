import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { es } from "date-fns/locale";

import { environmentalSensorService } from "@/app/services/environmentalSensor.service";
import { useAuthStore } from "@/auth/store/auth.store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  const [newKey, setNewKey] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editKey, setEditKey] = useState("");
  const [editConfig, setEditConfig] = useState("{}");
  const [error, setError] = useState("");
  const { data: catalog = [], isLoading: catalogLoading, isError: catalogError } = useQuery({ queryKey: ["sensor-catalog", "sensors"], queryFn: environmentalSensorService.getCatalog, enabled: Boolean(canReadCatalog) });
  const { data: installed = [], isLoading, isError } = useQuery({ queryKey: ["device-sensors", deviceId], queryFn: () => environmentalSensorService.getDeviceSensors(deviceId), enabled: Boolean(canRead && deviceId) });
  const invalidate = () => { queryClient.invalidateQueries({ queryKey: ["device-sensors", deviceId] }); setError(""); };
  const add = useMutation({ mutationFn: (payload: { sensorId: string; key?: string; config: Record<string, unknown> }) => environmentalSensorService.addDeviceSensor(deviceId, payload), onSuccess: invalidate, onError: () => setError("No se pudo agregar el sensor. Verifica que la clave no esté en uso.") });
  const update = useMutation({ mutationFn: ({ id, key, config }: { id: string; key: string; config: Record<string, unknown> }) => environmentalSensorService.updateDeviceSensor(deviceId, id, { key, config }), onSuccess: () => { invalidate(); setEditId(null); }, onError: () => setError("No se pudo actualizar el sensor. Verifica la clave y la configuración.") });
  const remove = useMutation({ mutationFn: (id: string) => environmentalSensorService.removeDeviceSensor(deviceId, id), onSuccess: invalidate, onError: () => setError("No se pudo quitar el sensor.") });

  if (!canRead) return null;
  const addSensor = () => {
    if (!modelId) { setError("Selecciona un modelo de sensor."); return; }
    add.mutate({ sensorId: modelId, ...(newKey.trim() ? { key: newKey.trim() } : {}), config: {} });
  };
  const saveEdit = () => {
    if (!editId) return;
    try {
      const config: unknown = JSON.parse(editConfig);
      if (!config || Array.isArray(config) || typeof config !== "object") throw new Error("invalid config");
      update.mutate({ id: editId, key: editKey.trim(), config: config as Record<string, unknown> });
    } catch { setError("La configuración debe ser un objeto JSON válido."); }
  };

  return <Card>
    <CardHeader><CardTitle className="text-lg">Sensores del dispositivo</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      {isLoading ? <p className="text-sm text-muted-foreground">Cargando sensores…</p> : isError ? <p role="alert" className="text-sm text-destructive">No se pudieron cargar los sensores.</p> : installed.length === 0 ? <p className="text-sm text-muted-foreground">No hay sensores asociados.</p> : <div className="space-y-3">
        {installed.map((sensor) => {
          const model = catalog.find((entry) => entry.id === sensor.sensorId);
          return <div key={sensor.id} className="rounded-md border p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">{model?.name ?? sensor.key}</p>
                <p className="text-sm text-muted-foreground">{sensor.key} · {getSensorInstallationStatusLabel(sensor.isActive ? "active" : "inactive")}</p>
                {sensor.installedAt && <p className="text-xs text-muted-foreground">Instalado: {format(new Date(sensor.installedAt), "PP p", { locale: es })}</p>}
                {model?.variables.map((variable) => <p key={variable.code} className="text-xs text-muted-foreground">{variable.name} ({variable.unit}): {rangeFormatter.format(variable.min)}–{rangeFormatter.format(variable.max)} {variable.unit}</p>)}
              </div>
              {canWrite && sensor.isActive && <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => { setEditId(sensor.id); setEditKey(sensor.key); setEditConfig(JSON.stringify(sensor.config, null, 2)); }}>Editar</Button>
                <Button type="button" variant="destructive" size="sm" onClick={() => showConfirmDialog(`¿Deseas quitar el sensor ${sensor.key}? Sus lecturas anteriores se conservarán.`, async () => { await remove.mutateAsync(sensor.id); })}>Quitar</Button>
              </div>}
            </div>
            {editId === sensor.id && <div className="mt-3 space-y-2 border-t pt-3">
              <label className="block text-sm">Clave<Input value={editKey} onChange={(event) => setEditKey(event.target.value)} /></label>
              <label className="block text-sm">Configuración JSON<textarea className="min-h-20 w-full rounded-md border bg-background p-2 font-mono text-sm" value={editConfig} onChange={(event) => setEditConfig(event.target.value)} /></label>
              <div className="flex gap-2"><Button type="button" size="sm" onClick={saveEdit} disabled={update.isPending}>Guardar sensor</Button><Button type="button" variant="outline" size="sm" onClick={() => setEditId(null)}>Cancelar</Button></div>
            </div>}
          </div>;
        })}
      </div>}
      {canWrite && canReadCatalog && <div className="space-y-2 border-t pt-4">
        <label className="block text-sm font-medium" htmlFor="sensor-model">Modelo de sensor</label>
        <select id="sensor-model" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={modelId} onChange={(event) => setModelId(event.target.value)} disabled={catalogLoading || catalogError}>
          <option value="">Seleccionar modelo</option>
          {catalog.map((model) => <option key={model.id} value={model.id}>{model.name} · {model.variables.map((variable) => `${variable.name} (${variable.unit})`).join(", ")}</option>)}
        </select>
        <label className="block text-sm" htmlFor="sensor-key">Clave opcional</label>
        <Input id="sensor-key" value={newKey} onChange={(event) => setNewKey(event.target.value)} placeholder="Se generará automáticamente" />
        <Button type="button" onClick={addSensor} disabled={add.isPending || catalogLoading || catalogError}>Agregar sensor</Button>
      </div>}
      {catalogError && canReadCatalog && <p role="alert" className="text-sm text-destructive">No se pudo cargar el catálogo de sensores.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </CardContent>
  </Card>;
}
