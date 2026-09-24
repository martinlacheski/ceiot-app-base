import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FormPageLayout } from "@/components/custom/FormPageLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { catalogApi, type CatalogKind, type SensorVariableInput, type Variable } from "./catalogApi";
import { SLUG_PATTERN, validateSensorVariables } from "./catalogValidation";

const blankRow = (): SensorVariableInput => ({ variableId: "", minValue: 0, maxValue: 0, accuracy: "", resolution: "" });

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
  const variables = useQuery({ queryKey: ["admin-catalog", "variable-options"], queryFn: async () => {
    const page = await catalogApi.list("variables", { page: 1, perPage: 10000 });
    return page.items;
  }, enabled: sensors });
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
    if (!name.trim() || (sensors ? !manufacturer.trim() : !unit.trim())) { setError("Completá los campos obligatorios."); return; }
    const rowError = sensors ? validateSensorVariables(rows) : null;
    if (rowError) { setError(rowError); return; }
    setError(""); setSaving(true);
    const body = sensors ? { name: name.trim(), manufacturer: manufacturer.trim(), description: description.trim() || null, variables: rows, ...(id ? { isActive } : { code }) }
      : { name: name.trim(), unit: unit.trim(), description: description.trim() || null, ...(id ? { isActive } : { code }) };
    try {
      if (id) await catalogApi.update(kind, id, body); else await catalogApi.create(kind, body);
      await queryClient.invalidateQueries({ queryKey: ["admin-catalog"] });
      toast.success(id ? "Registro actualizado" : "Registro creado"); navigate(path);
    } catch { setError("No se pudo guardar. Verificá que el código sea único y los datos sean válidos."); }
    finally { setSaving(false); }
  };
  if (id && record.isPending) return <p role="status">Cargando...</p>;
  if (id && record.isError) return <p role="alert">No se pudo cargar el registro.</p>;
  const title = `${id ? "Editar" : "Nuevo"} ${sensors ? "sensor" : "variable"}`;
  return <FormPageLayout title={title} subtitle={sensors ? "Configurá el modelo y las variables que mide." : "Configurá los datos de la variable."} backUrl={path}>
    <form onSubmit={save} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="catalog-code">Código</Label><Input id="catalog-code" value={code} onChange={(event) => setCode(event.target.value)} disabled={Boolean(id)} required /></div><div className="space-y-2"><Label htmlFor="catalog-name">Nombre</Label><Input id="catalog-name" value={name} onChange={(event) => setName(event.target.value)} required /></div></div>
      <div className="space-y-2"><Label htmlFor="catalog-detail">{sensors ? "Fabricante" : "Unidad"}</Label><Input id="catalog-detail" value={sensors ? manufacturer : unit} onChange={(event) => sensors ? setManufacturer(event.target.value) : setUnit(event.target.value)} required /></div>
      <div className="space-y-2"><Label htmlFor="catalog-description">Descripción</Label><textarea id="catalog-description" className="min-h-20 w-full rounded-md border border-input bg-background p-2 text-foreground" value={description} onChange={(event) => setDescription(event.target.value)} /></div>
      {id && <div className="flex items-center gap-2"><Switch id="catalog-active" checked={isActive} onCheckedChange={setIsActive} /><Label htmlFor="catalog-active">Activo</Label></div>}
      {sensors && <section className="space-y-3"><h3 className="font-semibold">Variables que mide</h3>{rows.map((row, index) => <div key={index} className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-3 lg:grid-cols-6">
        <label className="space-y-1 text-sm">Variable<select aria-label={`Variable ${index + 1}`} className="h-10 w-full rounded-md border border-input bg-background px-2" value={row.variableId} onChange={(event) => updateRow(index, { variableId: event.target.value })}><option value="">Seleccionar</option>{variables.data?.filter((option: Variable) => option.isActive || option.id === row.variableId).map((option: Variable) => <option key={option.id} value={option.id}>{option.name} ({option.unit})</option>)}</select></label>
        {([ ["minValue", "Mín"], ["maxValue", "Máx"] ] as const).map(([field, label]) => <label key={field} className="space-y-1 text-sm">{label}<Input aria-label={`${label} ${index + 1}`} type="number" step="any" value={row[field]} onChange={(event) => updateRow(index, { [field]: Number(event.target.value) })} required /></label>)}
        {([ ["accuracy", "Precisión"], ["resolution", "Resolución"] ] as const).map(([field, label]) => <label key={field} className="space-y-1 text-sm">{label}<Input aria-label={`${label} ${index + 1}`} value={row[field]} onChange={(event) => updateRow(index, { [field]: event.target.value })} required /></label>)}
        <Button type="button" variant="outline" className="self-end" onClick={() => setRows((current) => current.filter((_, i) => i !== index))}>Quitar</Button>
      </div>)}<Button type="button" variant="outline" onClick={() => setRows((current) => [...current, blankRow()])}>Agregar variable</Button></section>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => navigate(path)}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button></div>
    </form>
  </FormPageLayout>;
}
