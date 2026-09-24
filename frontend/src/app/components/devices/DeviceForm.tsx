import { useForm } from "react-hook-form";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";
import { RefreshCw, Unplug } from "lucide-react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SmartDatePicker } from "@/components/custom/SmartDatePicker";
import { SearchableSelect } from "@/components/custom/SearchableSelect";
import { getDeviceStatusLabel } from "@/utils/status-labels";
import {
  FULL_PAGE_FORM_ACTION_BUTTON_CLASS,
  FULL_PAGE_FORM_ACTIONS_CLASS,
  FULL_PAGE_FORM_BACK_LABEL,
  getFullPageFormPrimaryLabel,
} from "@/components/custom/fullPageFormActions";
import { cn } from "@/lib/utils";
import { generateSerial } from "@/lib/serial.utils";
import { showConfirmDialog } from "@/store/confirm.store";
import { useDeviceTypes, useUnpairDevice } from "@/app/hooks/useDevices";
import { useAuthStore } from "@/auth/store/auth.store";
import { environmentalSensorService } from "@/app/services/environmentalSensor.service";

import type {
  Device,
  DeviceCreate,
  DeviceUpdate,
} from "@/app/types/device.types";

const DEFAULT_DEVICE_TYPE_ID = "6a8e2b8d-2f9d-4f8d-8b7b-5b8f8e4d2c32";

const buildDeviceSchema = (isEditing: boolean) =>
  z.object({
    serial: z
      .string()
      .regex(
        /^IOT-[A-Z0-9]{4}-[A-Z0-9]{4}$/,
        "El serial debe tener formato válido IOT-XXXX-XXXX",
      ),
    name: z.string().optional(),
    description: isEditing
      ? z.string().min(1, "El nombre del servicio es requerido")
      : z.string().optional(),
    deviceTypeId: z.string().min(1, "El tipo de dispositivo es requerido"),
    model: z.string().optional(),
    batch: z.string().optional(),
    manufactureDate: z.date().optional(),
    enabled: z.boolean().default(true),
  });

type DeviceFormInput = z.input<ReturnType<typeof buildDeviceSchema>>;
type DeviceFormValues = z.infer<ReturnType<typeof buildDeviceSchema>>;

interface DeviceFormProps {
  initialData?: Device;
  onSubmit: (data: DeviceCreate | DeviceUpdate) => void;
  isLoading?: boolean;
  isEditing?: boolean;
  mode?: "admin" | "user";
  extraContent?: React.ReactNode;
  onUnpairSuccess?: () => void;
}

export function DeviceForm({
  initialData,
  onSubmit,
  isLoading,
  isEditing,
  mode = "admin",
  extraContent,
  onUnpairSuccess,
}: DeviceFormProps) {
  const navigate = useNavigate();
  const unpairDevice = useUnpairDevice();
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.isAdmin || false;
  const isUserMode = mode === "user";
  const isOwner = initialData?.environment?.ownerId === user?.id;
  const canManageDevice = isAdmin || isOwner;
  const showDeviceIdentityFields = isEditing || !isUserMode;
  const showTechnicalFields = !isUserMode;
  const primaryLabel = getFullPageFormPrimaryLabel(
    isEditing ? "edit" : "create",
    "Crear Dispositivo",
  );
  const { data: deviceTypesData } = useDeviceTypes();
  const deviceTypes = deviceTypesData?.items ?? [];
  const canWriteSensors = Boolean(user?.isAdmin || user?.permissions?.includes("device_sensor:write"));
  const canReadCatalog = Boolean(user?.isAdmin || user?.permissions?.includes("sensor_catalog:read"));
  const { data: sensorCatalog = [], isError: catalogError } = useQuery({
    queryKey: ["sensor-catalog", "sensors"],
    queryFn: environmentalSensorService.getCatalog,
    enabled: !isEditing && canWriteSensors && canReadCatalog,
  });
  const [sensors, setSensors] = useState<{ sensorId: string }[]>([]);
  const [sensorError, setSensorError] = useState("");

  const form = useForm<DeviceFormInput, unknown, DeviceFormValues>({
    resolver: zodResolver(buildDeviceSchema(!!isEditing)),
    mode: "onBlur",
    defaultValues: {
      serial: initialData?.serial || (isEditing ? "" : generateSerial()),
      name: initialData?.name || "",
      description: initialData?.description || "",
      deviceTypeId: initialData?.deviceTypeId || DEFAULT_DEVICE_TYPE_ID,
      model: initialData?.model || "",
      batch: initialData?.batch || "",
      manufactureDate: initialData?.manufactureDate
        ? (() => {
            const [y, m, d] = initialData.manufactureDate
              .split("-")
              .map(Number);
            return new Date(y, m - 1, d);
          })()
        : undefined,
      enabled: initialData?.enabled ?? true,
    },
  });

  const handleGenerateSerial = () => {
    form.setValue("serial", generateSerial(), { shouldValidate: true });
  };

  const handleUnpair = () => {
    if (!initialData?.id) return;

    showConfirmDialog(
      "¿Estás seguro de desvincular este dispositivo? Deberás volver a asociarlo para poder utilizarlo nuevamente.",
      async () => {
        await unpairDevice.mutateAsync(initialData.id);
        onUnpairSuccess?.();
      },
    );
  };

  const handleSubmit = (values: DeviceFormValues) => {
    const selectedType = deviceTypes.find((type) => type.id === values.deviceTypeId);
    const isEnvironmental = values.deviceTypeId === DEFAULT_DEVICE_TYPE_ID || selectedType?.code === "environmental";
    if (!isEditing && isEnvironmental && sensors.filter((sensor) => sensor.sensorId).length === 0) {
      setSensorError("Agregá al menos un sensor");
      return;
    }
    if (!isEditing && sensors.some((sensor) => !sensor.sensorId)) {
      setSensorError("Seleccioná un modelo para cada sensor");
      return;
    }
    setSensorError("");
    const updatePayload: DeviceUpdate = {
      name: values.name || "",
      description: values.description,
      deviceTypeId: values.deviceTypeId,
    };

    if (showTechnicalFields) {
      updatePayload.enabled = values.enabled;
    }

    const confirmMessage = isEditing
      ? "¿Estás seguro de guardar los cambios?"
      : "¿Estás seguro de crear este dispositivo?";

    showConfirmDialog(confirmMessage, async () => {
      if (isEditing) {
        onSubmit(updatePayload);
        return;
      }

      const createPayload: DeviceCreate = {
        serial: values.serial.toUpperCase(),
        name: values.name || "",
        description: values.description,
        deviceTypeId: values.deviceTypeId,
        model: values.model,
        batch: values.batch,
        manufactureDate: values.manufactureDate
          ? format(values.manufactureDate, "yyyy-MM-dd")
          : undefined,
        sensors: sensors.map((sensor) => ({ sensorId: sensor.sensorId })),
      };

      onSubmit(createPayload);
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-8">
        {showDeviceIdentityFields && (
          <div className="space-y-4">
            {isEditing && initialData?.environmentId && canManageDevice && (
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={handleUnpair}
                >
                  <Unplug className="mr-1.5 h-3.5 w-3.5" />
                  Desvincular Dispositivo
                </Button>
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4 md:items-end">
              <div>
                <FormField
                  control={form.control}
                  name="serial"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Número de Serie</FormLabel>
                      <FormControl>
                        <div className="flex gap-2">
                          <Input
                            placeholder="IOT-XXXX-XXXX"
                            {...field}
                            disabled={isEditing}
                            className="font-mono"
                            onChange={(event) =>
                              field.onChange(event.target.value.toUpperCase())
                            }
                          />
                          {!isEditing && (
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              onClick={handleGenerateSerial}
                              title="Generar Serial Automático"
                            >
                              <RefreshCw className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div>
                <FormField
                  control={form.control}
                  name="deviceTypeId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tipo de Dispositivo</FormLabel>
                      <SearchableSelect
                        options={deviceTypes.map((deviceType) => ({
                          label: deviceType.name,
                          value: deviceType.id,
                        }))}
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="Seleccionar tipo"
                        disabled={isEditing || deviceTypes.length === 0}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 items-end gap-4 md:col-span-2">
                <FormItem>
                  <FormLabel>Estado</FormLabel>
                  <div className="flex h-10 items-center">
                    <div
                      className={cn(
                        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                        (initialData?.status || "new") === "new" &&
                          "border-transparent bg-blue-500 text-white shadow hover:bg-blue-500/80",
                        initialData?.status === "paired" &&
                          "border-transparent bg-indigo-500 text-white shadow hover:bg-indigo-500/80",
                        initialData?.status === "active" &&
                          "border-transparent bg-green-500 text-white shadow hover:bg-green-500/80",
                        initialData?.status === "maintenance" &&
                          "border-transparent bg-yellow-500 text-white shadow hover:bg-yellow-500/80",
                        initialData?.status === "unpaired" &&
                          "border-transparent bg-gray-500 text-white shadow hover:bg-gray-500/80",
                      )}
                    >
                      {getDeviceStatusLabel(initialData?.status || "new")}
                    </div>
                  </div>
                </FormItem>


                <FormField
                  control={form.control}
                  name="enabled"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Habilitado</FormLabel>
                      <FormControl>
                        <div className="flex h-10 items-center space-x-2">
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            disabled={isLoading || !canManageDevice}
                          />
                          <span className="text-sm text-muted-foreground">
                            {field.value ? "Si" : "No"}
                          </span>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nombre</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Ingrese el nombre del dispositivo"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Descripción</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Ej.: Monitoreo del invernadero"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

        </div>

        {!isEditing && canWriteSensors && canReadCatalog && (
          <section className="space-y-4" aria-label="Sensores">
            <h3 className="text-sm font-medium">Sensores</h3>
            {sensors.map((sensor, index) => {
              const model = sensorCatalog.find((entry) => entry.id === sensor.sensorId);
              return <div key={index} className="space-y-2">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-0 flex-1">
                    <label className="mb-1 block text-sm" htmlFor={`sensor-model-${index}`}>Modelo del sensor {index + 1}</label>
                    <select id={`sensor-model-${index}`} className="min-h-11 w-full rounded-md border bg-background px-3 text-sm" value={sensor.sensorId} onChange={(event) => setSensors((rows) => rows.map((row, rowIndex) => rowIndex === index ? { sensorId: event.target.value } : row))}>
                      <option value="">Seleccionar modelo</option>
                      {sensorCatalog.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} — {entry.variables.map((variable) => variable.name).join(", ")}</option>)}
                    </select>
                  </div>
                  <Button type="button" variant="outline" className="min-h-11" onClick={() => setSensors((rows) => rows.filter((_, rowIndex) => rowIndex !== index))} aria-label={`Quitar sensor ${index + 1}`}>Quitar</Button>
                </div>
                {model && <p className="text-xs text-muted-foreground">{model.variables.map((variable) => `${variable.name}: ${variable.min}–${variable.max} ${variable.unit}`).join(" · ")}</p>}
              </div>;
            })}
            <Button type="button" variant="outline" className="min-h-11" onClick={() => { setSensors((rows) => [...rows, { sensorId: "" }]); setSensorError(""); }}>Agregar sensor</Button>
            {catalogError && <p role="alert" className="text-sm text-destructive">No se pudo cargar el catálogo de sensores.</p>}
            {sensorError && <p role="alert" className="text-sm text-destructive">{sensorError}</p>}
          </section>
        )}

        {showTechnicalFields && (
          <div className="space-y-4 rounded-md border bg-muted/50 p-4">
            <h3 className="text-sm font-medium text-muted-foreground">
              Datos Técnicos
            </h3>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
              <FormField
                control={form.control}
                name="model"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Modelo</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Modelo del dispositivo"
                        {...field}
                        disabled={isEditing}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="batch"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Lote</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Lote de fabricación"
                        {...field}
                        disabled={isEditing}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="manufactureDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Fecha de fabricación</FormLabel>
                    <SmartDatePicker
                      value={field.value}
                      onChange={field.onChange}
                      readOnly={isEditing}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />

            </div>
          </div>
        )}

        {extraContent}

        <div className={`${FULL_PAGE_FORM_ACTIONS_CLASS} pt-4`}>
          <Button
            type="button"
            variant="outline"
            className={FULL_PAGE_FORM_ACTION_BUTTON_CLASS}
            onClick={() => navigate(-1)}
          >
            {FULL_PAGE_FORM_BACK_LABEL}
          </Button>
          <Button
            type="submit"
            className={FULL_PAGE_FORM_ACTION_BUTTON_CLASS}
            disabled={isLoading}
          >
            {isLoading && (
              <span aria-hidden="true" className="animate-spin">
                ⏳
              </span>
            )}
            {primaryLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
