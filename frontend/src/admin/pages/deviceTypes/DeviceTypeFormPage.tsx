import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { environmentalSensorService } from "@/app/services/environmentalSensor.service";
import { FormPageLayout } from "@/components/custom/FormPageLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FULL_PAGE_FORM_ACTIONS_CLASS, FULL_PAGE_FORM_ACTION_BUTTON_CLASS, FULL_PAGE_FORM_BACK_LABEL, getFullPageFormPrimaryLabel } from "@/components/custom/fullPageFormActions";
import { deviceTypesApi } from "./deviceTypesApi";
import { buildPayload, validateDeviceTypeForm, type DeviceTypeFormValues, type DeviceTypeSensorRow } from "./deviceTypeValidation";

const PATH = "/admin/device-types";
const emptyValues: DeviceTypeFormValues = { code: "", name: "", hardwareModel: "", description: "", telemetryIntervalS: "", offlineAfterS: "", minSensors: "0", configTemplate: "{}" };
const blankRow = (): DeviceTypeSensorRow => ({ sensorId: "", required: false, maxCount: 1, includedByDefault: false });
const numberText = (value: number | null | undefined) => (value === null || value === undefined ? "" : String(value));
const selectClass = "h-10 min-w-40 w-full rounded-md border border-input bg-background px-2 text-foreground";

function serverMessage(error: unknown): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" ? detail : "No se pudo guardar. Verifica que el código y el nombre sean únicos y los datos sean válidos.";
}

export function DeviceTypeFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const creating = !id;
  const [values, setValues] = useState<DeviceTypeFormValues>(emptyValues);
  const [rows, setRows] = useState<DeviceTypeSensorRow[]>([]);
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const record = useQuery({ queryKey: ["admin-device-types", "detail", id], queryFn: () => deviceTypesApi.get(id!), enabled: Boolean(id) });
  const catalog = useQuery({ queryKey: ["sensor-catalog", "sensors"], queryFn: environmentalSensorService.getCatalog });

  useEffect(() => {
    const item = record.data;
    if (!item) return;
    setValues({
      code: item.code ?? "", name: item.name, hardwareModel: item.hardwareModel ?? "", description: item.description ?? "",
      telemetryIntervalS: numberText(item.telemetryIntervalS), offlineAfterS: numberText(item.offlineAfterS), minSensors: String(item.minSensors),
      configTemplate: JSON.stringify(item.configTemplate ?? {}, null, 2),
    });
    setRows(item.sensors.map((sensor) => ({ sensorId: sensor.sensorId, required: sensor.required, maxCount: sensor.maxCount, includedByDefault: sensor.includedByDefault })));
    setIsActive(item.isActive);
  }, [record.data]);

  const setField = (field: keyof DeviceTypeFormValues, value: string) => setValues((current) => ({ ...current, [field]: value }));
  const updateRow = (index: number, patch: Partial<DeviceTypeSensorRow>) => setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const model = (sensorId: string) => catalog.data?.find((entry) => entry.id === sensorId);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const problem = validateDeviceTypeForm(values, rows, { creating });
    if (problem) { setError(problem); return; }
    setError(""); setSaving(true);
    const payload = buildPayload(values, rows, { creating });
    try {
      if (id) await deviceTypesApi.update(id, { ...payload, isActive }); else await deviceTypesApi.create(payload);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["admin-device-types"] }), queryClient.invalidateQueries({ queryKey: ["devices", "types"] })]);
      toast.success(id ? "Tipo de dispositivo actualizado" : "Tipo de dispositivo creado");
      navigate(PATH);
    } catch (caught) { setError(serverMessage(caught)); }
    finally { setSaving(false); }
  };

  if (id && record.isPending) return <p role="status">Cargando...</p>;
  if (id && record.isError) return <p role="alert">No se pudo cargar el tipo de dispositivo.</p>;
  const primaryLabel = getFullPageFormPrimaryLabel(id ? "edit" : "create", "Crear tipo de dispositivo");

  return <FormPageLayout title={`${id ? "Editar" : "Nuevo"} tipo de dispositivo`} subtitle="Define la plantilla de los dispositivos de este tipo." backUrl={PATH}>
    <form onSubmit={save} className="space-y-6">
      <div data-testid="device-type-main-fields" className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="min-w-0 space-y-2"><Label htmlFor="type-code">Código</Label><Input id="type-code" value={values.code} onChange={(event) => setField("code", event.target.value)} disabled={!creating} required /></div>
        <div className="min-w-0 space-y-2"><Label htmlFor="type-name">Nombre</Label><Input id="type-name" value={values.name} onChange={(event) => setField("name", event.target.value)} required /></div>
        <div className="min-w-0 space-y-2"><Label htmlFor="type-hardware">Modelo de placa</Label><Input id="type-hardware" value={values.hardwareModel} onChange={(event) => setField("hardwareModel", event.target.value)} /></div>
      </div>
      <div className="space-y-2"><Label htmlFor="type-description">Descripción</Label><textarea id="type-description" className="min-h-20 w-full rounded-md border border-input bg-background p-2 text-foreground" value={values.description} onChange={(event) => setField("description", event.target.value)} /></div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="min-w-0 space-y-2"><Label htmlFor="type-interval">Intervalo de telemetría (s)</Label><Input id="type-interval" type="number" min={5} max={86400} value={values.telemetryIntervalS} onChange={(event) => setField("telemetryIntervalS", event.target.value)} /></div>
        <div className="min-w-0 space-y-2"><Label htmlFor="type-offline">Considerar sin conexión después de (s)</Label><Input id="type-offline" type="number" min={10} max={604800} value={values.offlineAfterS} onChange={(event) => setField("offlineAfterS", event.target.value)} /></div>
        <div className="min-w-0 space-y-2"><Label htmlFor="type-min-sensors">Mínimo de sensores</Label><Input id="type-min-sensors" type="number" min={0} value={values.minSensors} onChange={(event) => setField("minSensors", event.target.value)} /></div>
      </div>
      {!creating && <div className="flex items-center gap-2"><Switch id="type-active" checked={isActive} onCheckedChange={setIsActive} /><Label htmlFor="type-active">Activo</Label></div>}

      <section className="min-w-0 space-y-3" aria-label="Sensores compatibles">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold">Sensores compatibles</h3>
          <Button type="button" className="h-11" onClick={() => setRows((current) => [...current, blankRow()])}><Plus data-icon="inline-start" />Agregar sensor</Button>
        </div>
        <div className="min-w-0 overflow-x-auto rounded-md border"><Table>
          <TableHeader><TableRow>{["Sensor", "Variables", "Obligatorio", "Máx.", "Incluido por defecto", "Acciones"].map((label) => <TableHead key={label} className="text-center">{label}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{rows.length === 0 ? <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">No hay sensores compatibles.</TableCell></TableRow> : rows.map((row, index) => {
            const current = model(row.sensorId);
            const taken = new Set(rows.filter((_, i) => i !== index).map((other) => other.sensorId));
            return <TableRow key={index}>
              <TableCell><select aria-label={`Sensor ${index + 1}`} className={selectClass} value={row.sensorId} onChange={(event) => updateRow(index, { sensorId: event.target.value })}>
                <option value="">Seleccionar</option>
                {catalog.data?.filter((option) => !taken.has(option.id)).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
              </select></TableCell>
              <TableCell className="min-w-48 whitespace-normal text-center text-xs text-muted-foreground">{current ? current.variables.map((variable) => `${variable.name} (${variable.unit})`).join(", ") : "—"}</TableCell>
              <TableCell className="text-center"><input type="checkbox" className="size-5 accent-primary" aria-label={`Obligatorio ${index + 1}`} checked={row.required} onChange={(event) => updateRow(index, { required: event.target.checked })} /></TableCell>
              <TableCell><Input className="mx-auto w-20 text-center" type="number" min={1} aria-label={`Máx. ${index + 1}`} value={row.maxCount} onChange={(event) => updateRow(index, { maxCount: event.target.value === "" ? "" : Number(event.target.value) })} /></TableCell>
              <TableCell className="text-center"><input type="checkbox" className="size-5 accent-primary" aria-label={`Incluido por defecto ${index + 1}`} checked={row.includedByDefault} onChange={(event) => updateRow(index, { includedByDefault: event.target.checked })} /></TableCell>
              <TableCell className="text-center"><Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Quitar sensor" onClick={() => setRows((list) => list.filter((_, i) => i !== index))}><Trash2 className="size-4" /></Button></TooltipTrigger><TooltipContent>Quitar sensor</TooltipContent></Tooltip></TableCell>
            </TableRow>;
          })}</TableBody>
        </Table></div>
      </section>

      <div className="space-y-2"><Label htmlFor="type-config">Plantilla de configuración (JSON)</Label><textarea id="type-config" className="min-h-28 w-full rounded-md border border-input bg-background p-2 font-mono text-sm text-foreground" value={values.configTemplate} onChange={(event) => setField("configTemplate", event.target.value)} spellCheck={false} /><p className="text-xs text-muted-foreground">Objeto JSON con los valores por defecto del hardware (pines, I2C, etc.).</p></div>

      {error && <p role="alert" className="text-destructive">{error}</p>}
      <div className={FULL_PAGE_FORM_ACTIONS_CLASS} data-testid="form-actions">
        <Button type="button" variant="outline" className={FULL_PAGE_FORM_ACTION_BUTTON_CLASS} onClick={() => navigate(PATH)} disabled={saving}>{FULL_PAGE_FORM_BACK_LABEL}</Button>
        <Button type="submit" className={FULL_PAGE_FORM_ACTION_BUTTON_CLASS} disabled={saving} aria-label={primaryLabel}>{saving ? "Guardando..." : primaryLabel}</Button>
      </div>
    </form>
  </FormPageLayout>;
}
