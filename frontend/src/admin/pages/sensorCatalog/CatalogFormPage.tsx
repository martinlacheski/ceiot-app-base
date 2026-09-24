import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FormPageLayout } from "@/components/custom/FormPageLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FULL_PAGE_FORM_ACTIONS_CLASS, FULL_PAGE_FORM_ACTION_BUTTON_CLASS, FULL_PAGE_FORM_BACK_LABEL, getFullPageFormPrimaryLabel } from "@/components/custom/fullPageFormActions";
import { Plus, Trash2 } from "lucide-react";
import { useVariableOptions } from "./useVariableOptions";
import { catalogApi, type CatalogKind, type SensorVariableInput, type Variable } from "./catalogApi";
import { SLUG_PATTERN, validateSensorVariables } from "./catalogValidation";

const blankRow = (): SensorVariableInput => ({ variableId: "", minValue: "", maxValue: "", accuracy: "", resolution: "" });

export function CatalogFormPage({ kind }: { kind: CatalogKind }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sensors = kind === "sensors";
  const path = `/admin/${kind}`;
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [rows, setRows] = useState<SensorVariableInput[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const record = useQuery({ queryKey: ["admin-catalog", kind, id], queryFn: () => catalogApi.get(kind, id!), enabled: Boolean(id) });
  const variables = useVariableOptions(sensors);
  useEffect(() => {
    if (!record.data) return;
    const item = record.data;
    setCode(item.code); setName(item.name); setDescription(item.description ?? ""); setIsActive(item.isActive);
    if ("manufacturer" in item) { setManufacturer(item.manufacturer); setRows(item.variables.map((row) => ({ variableId: row.variableId, minValue: row.minValue, maxValue: row.maxValue, accuracy: row.accuracy, resolution: row.resolution }))); }
    else setUnit(item.unit);
  }, [record.data]);
  const updateRow = (index: number, patch: Partial<SensorVariableInput>) => setRows((current) => current.map((row, i) => i === index ? { ...row, ...patch } : row));
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!id && !SLUG_PATTERN.test(code)) { setError("El código debe ser un identificador en minúsculas, sin espacios."); return; }
    if (!name.trim() || (sensors ? !manufacturer.trim() : !unit.trim())) { setError("Completa los campos obligatorios."); return; }
    const rowError = sensors ? validateSensorVariables(rows) : null;
    if (rowError) { setError(rowError); return; }
    setError(""); setSaving(true);
    const body = sensors ? { name: name.trim(), manufacturer: manufacturer.trim(), description: description.trim() || null, variables: rows, ...(id ? { isActive } : { code }) }
      : { name: name.trim(), unit: unit.trim(), description: description.trim() || null, ...(id ? { isActive } : { code }) };
    try {
      if (id) await catalogApi.update(kind, id, body); else await catalogApi.create(kind, body);
      await queryClient.invalidateQueries({ queryKey: ["admin-catalog"] });
      toast.success(id ? "Registro actualizado" : "Registro creado"); navigate(path);
    } catch { setError("No se pudo guardar. Verifica que el código sea único y los datos sean válidos."); }
    finally { setSaving(false); }
  };
  if (id && record.isPending) return <p role="status">Cargando...</p>;
  if (id && record.isError) return <p role="alert">No se pudo cargar el registro.</p>;
  const title = `${id ? "Editar" : sensors ? "Nuevo" : "Nueva"} ${sensors ? "sensor" : "variable"}`;
  const primaryLabel = getFullPageFormPrimaryLabel(id ? "edit" : "create", sensors ? "Crear sensor" : "Crear variable");
  return <FormPageLayout title={title} subtitle={sensors ? "Configura el modelo y las variables que mide." : "Configura los datos de la variable."} backUrl={path}>
    <form onSubmit={save} className="space-y-6">
      <div data-testid="catalog-main-fields" className="grid grid-cols-1 gap-4 md:grid-cols-3"><div className="min-w-0 space-y-2"><Label htmlFor="catalog-code">Código</Label><Input id="catalog-code" value={code} onChange={(event) => setCode(event.target.value)} disabled={Boolean(id)} required /></div><div className="min-w-0 space-y-2"><Label htmlFor="catalog-name">Nombre</Label><Input id="catalog-name" value={name} onChange={(event) => setName(event.target.value)} required /></div><div className="min-w-0 space-y-2"><Label htmlFor="catalog-detail">{sensors ? "Fabricante" : "Unidad"}</Label><Input id="catalog-detail" value={sensors ? manufacturer : unit} onChange={(event) => sensors ? setManufacturer(event.target.value) : setUnit(event.target.value)} required /></div></div>
      <div className="space-y-2"><Label htmlFor="catalog-description">Descripción</Label><textarea id="catalog-description" className="min-h-20 w-full rounded-md border border-input bg-background p-2 text-foreground" value={description} onChange={(event) => setDescription(event.target.value)} /></div>
      {id && <div className="flex items-center gap-2"><Switch id="catalog-active" checked={isActive} onCheckedChange={setIsActive} /><Label htmlFor="catalog-active">Activo</Label></div>}
      {sensors && <section className="min-w-0 space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Variables que mide</h3><Button type="button" className="h-11" onClick={() => setRows((current) => [...current, blankRow()])}><Plus data-icon="inline-start" />Agregar variable</Button></div><div className="min-w-0 rounded-md border"><Table><TableHeader><TableRow>{["Variable", "Mín", "Máx", "Precisión", "Resolución", "Acciones"].map((label) => <TableHead key={label} className="text-center">{label}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.length === 0 ? <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">No hay variables agregadas.</TableCell></TableRow> : rows.map((row, index) => <TableRow key={index}>
        <TableCell><select aria-label={`Variable ${index + 1}`} className="h-10 min-w-40 w-full rounded-md border border-input bg-background px-2 text-foreground" value={row.variableId} onChange={(event) => updateRow(index, { variableId: event.target.value })}><option value="">Seleccionar</option>{variables.data?.filter((option: Variable) => option.isActive || option.id === row.variableId).map((option: Variable) => <option key={option.id} value={option.id}>{option.name} ({option.unit})</option>)}</select></TableCell>
        {([ ["minValue", "Mín"], ["maxValue", "Máx"] ] as const).map(([field, label]) => <TableCell key={field}><Input className="min-w-20" aria-label={`${label} ${index + 1}`} type="number" step="any" value={row[field]} onChange={(event) => updateRow(index, { [field]: event.target.value === "" ? "" : Number(event.target.value) })} /></TableCell>)}
        {([ ["accuracy", "Precisión"], ["resolution", "Resolución"] ] as const).map(([field, label]) => <TableCell key={field}><Input className="min-w-24" aria-label={`${label} ${index + 1}`} value={row[field]} onChange={(event) => updateRow(index, { [field]: event.target.value })} /></TableCell>)}
        <TableCell className="text-center"><Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Quitar variable" onClick={() => setRows((current) => current.filter((_, i) => i !== index))}><Trash2 className="size-4" /></Button></TooltipTrigger><TooltipContent>Quitar variable</TooltipContent></Tooltip></TableCell>
      </TableRow>)}</TableBody></Table></div></section>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <div className={FULL_PAGE_FORM_ACTIONS_CLASS} data-testid="form-actions"><Button type="button" variant="outline" className={FULL_PAGE_FORM_ACTION_BUTTON_CLASS} onClick={() => navigate(path)} disabled={saving}>{FULL_PAGE_FORM_BACK_LABEL}</Button><Button type="submit" className={FULL_PAGE_FORM_ACTION_BUTTON_CLASS} disabled={saving} aria-label={primaryLabel}>{saving ? "Guardando..." : primaryLabel}</Button></div>
    </form>
  </FormPageLayout>;
}
