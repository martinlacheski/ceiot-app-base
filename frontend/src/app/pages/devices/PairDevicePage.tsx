import { useId, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import type { Html5Qrcode } from "html5-qrcode";
import { Plus, QrCode } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/app/components/PageHeader";
import { SearchableSelect } from "@/components/custom/SearchableSelect";
import { useDebouncedSearch } from "@/hooks/useDebouncedSearch";
import {
  EnvironmentForm,
  type EnvironmentFormValues,
} from "@/app/components/environments/EnvironmentForm";
import { usePairDevice } from "@/app/hooks/useDevices";
import { useCreateEnvironment, useEnvironments } from "@/app/hooks/useEnvironments";
import { useMountEffect } from "@/app/hooks/useMountEffect";
import { deviceService } from "@/app/services/device.service";
import { useAuthStore } from "@/auth/store/auth.store";
import { showConfirmDialog } from "@/store/confirm.store";
import type { DevicePairingRequest } from "@/app/types/device.types";

const SERIAL_LENGTH = 13;
const SERIAL_FORMAT_REGEX = /^IOT-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const SERIAL_FORMAT_ERROR = "El serial debe tener formato válido IOT-XXXX-XXXX";

const serialSchema = z
  .string()
  .length(SERIAL_LENGTH, SERIAL_FORMAT_ERROR)
  .regex(SERIAL_FORMAT_REGEX, SERIAL_FORMAT_ERROR);

const pairDeviceSchema = z.object({
  serial: serialSchema,
  environmentId: z.string().min(1, "Debe seleccionar un establecimiento"),
  description: z
    .string()
    .trim()
    .min(1, "El nombre del servicio es requerido"),
});

type PairDeviceFormInput = z.input<typeof pairDeviceSchema>;
type PairDeviceFormValues = z.output<typeof pairDeviceSchema>;

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return fallback;
  }

  const detail = (error as { response?: { data?: { detail?: unknown } } })
    .response?.data?.detail;

  if (typeof detail === "string") {
    return detail;
  }

  if (
    typeof detail === "object" &&
    detail !== null &&
    "message" in detail &&
    typeof (detail as { message?: unknown }).message === "string"
  ) {
    return (detail as { message: string }).message;
  }

  return fallback;
};

interface QrScannerViewProps {
  onDecode: (rawText: string) => void;
  onError: (message: string) => void;
}

/**
 * Mounts the html5-qrcode camera stream on mount and tears it down on
 * unmount. Must be conditionally mounted by the parent (only while the
 * scanner dialog is open) so the camera stream starts/stops cleanly.
 */
function QrScannerView({ onDecode, onError }: QrScannerViewProps) {
  const elementId = `qr-reader-${useId().replace(/:/g, "")}`;
  const instanceRef = useRef<Html5Qrcode | null>(null);
  const decodedRef = useRef(false);
  // html5-qrcode's stop() can throw synchronously (not just reject) when
  // called on a scanner that isn't running. Both the decode success path
  // and the unmount cleanup can race to stop the same scanner, so this ref
  // makes sure stop() is only ever attempted once, and always inside a
  // try/await/catch that swallows sync throws too.
  const stopPromiseRef = useRef<Promise<void> | null>(null);

  const stopScanner = () => {
    if (stopPromiseRef.current) return stopPromiseRef.current;

    const instance = instanceRef.current;
    if (!instance) return Promise.resolve();

    stopPromiseRef.current = (async () => {
      try {
        await instance.stop();
      } catch {
        // Already stopped, never started, or stream lost — nothing to do.
      }
    })();

    return stopPromiseRef.current;
  };

  useMountEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled) return;

        const scanner = new Html5Qrcode(elementId, /* verbose= */ false);
        instanceRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 250 },
          (decodedText) => {
            if (decodedRef.current) return;
            decodedRef.current = true;
            stopScanner().finally(() => onDecode(decodedText));
          },
          () => {
            // Per-frame "no QR found yet" callback — expected, ignore.
          },
        );
      } catch {
        if (!cancelled) {
          onError(
            "No se pudo acceder a la cámara. Verificá los permisos del navegador.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      stopScanner().finally(() => {
        instanceRef.current?.clear();
      });
    };
  });

  return (
    <div
      id={elementId}
      className="mx-auto w-full max-w-sm overflow-hidden rounded-md"
    />
  );
}

export default function PairDevicePage() {
  const navigate = useNavigate();
  const pairDevice = usePairDevice();
  const { user } = useAuthStore();
  const [checking, setChecking] = useState(false);
  const [environmentDialogOpen, setEnvironmentDialogOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [selectedEnvironmentLabel, setSelectedEnvironmentLabel] = useState<
    string | undefined
  >(undefined);

  const environmentSearch = useDebouncedSearch();
  const { data: environmentsData, isLoading: isLoadingEnvs } = useEnvironments({
    page: 1,
    perPage: 100,
    isActive: true,
    sortBy: "name",
    sortOrder: "asc",
    ownerId: user?.id,
    search: environmentSearch.debounced || undefined,
  });

  const createEnvironment = useCreateEnvironment();

  const form = useForm<PairDeviceFormInput, unknown, PairDeviceFormValues>({
    resolver: zodResolver(pairDeviceSchema),
    mode: "onChange",
    defaultValues: {
      serial: "",
      environmentId: "",
      description: "",
    },
  });

  const checkDeviceSerial = async (serialOverride?: string) => {
    const serial = serialOverride ?? form.getValues("serial");
    if (!serial || serial.length < 5) return;

    setChecking(true);
    try {
      const result = await deviceService.checkSerial(serial);
      if (result.status === "not_found") {
        form.setError("serial", {
          type: "manual",
          message: "No se encontró un dispositivo con este número de serie.",
        });
      } else if (result.status === "paired") {
        form.setError("serial", {
          type: "manual",
          message:
            result.message ||
            "Este dispositivo ya está asociado a otro establecimiento.",
        });
      } else {
        form.clearErrors("serial");
      }
    } catch (error) {
      console.error("Error Checking Serial", error);
    } finally {
      setChecking(false);
    }
  };

  const handleScanResult = (rawText: string) => {
    const candidate = rawText.trim().toUpperCase();
    const parsed = serialSchema.safeParse(candidate);

    setScannerOpen(false);

    if (!parsed.success) {
      toast.error(
        "El código escaneado no tiene el formato de un serial IOT válido.",
      );
      return;
    }

    form.setValue("serial", parsed.data, {
      shouldValidate: true,
      shouldDirty: true,
    });
    checkDeviceSerial(parsed.data);
  };

  const handleScanError = (message: string) => {
    setScannerOpen(false);
    toast.error(message);
  };

  const handleCreateEnvironment = async (values: EnvironmentFormValues) => {
    const payload = {
      ...values,
      description: values.description || "",
      isActive: values.isActive ?? true,
    };

    try {
      const savedEnvironment = await createEnvironment.mutateAsync(payload);
      toast.success("Establecimiento creado correctamente");
      setEnvironmentDialogOpen(false);
      setSelectedEnvironmentLabel(savedEnvironment.name);
      form.setValue("environmentId", savedEnvironment.id, {
        shouldValidate: true,
        shouldDirty: true,
      });
    } catch (error) {
      toast.error(
        getErrorMessage(error, "No se pudo crear el establecimiento"),
      );
    }
  };

  const handleSubmit = (values: PairDeviceFormValues) => {
    const pairingRequest: DevicePairingRequest = {
      serial: values.serial.toUpperCase(),
      environmentId: values.environmentId,
      description: values.description,
    };

    showConfirmDialog(
      "¿Está seguro de que desea asociar este dispositivo?",
      async () => {
        pairDevice.mutate(
          pairingRequest,
          {
            onSuccess: () => {
              navigate("/app/devices");
            },
          },
        );
      },
    );
  };

  // The server already filters to establishments owned by this user
  // (`ownerId`) and by the typed search term; this is a safety net.
  const environments = (environmentsData?.items || []).filter(
    (env) => env.ownerId === user?.id,
  );

  return (
    <>
      <PageHeader
        title="Asociar Dispositivo"
        subtitle="Ingresá el número de serie de tu dispositivo y seleccioná el establecimiento donde estará ubicado."
        backUrl="/app/devices"
      >
        <div className="w-full min-w-0 rounded-lg border bg-card p-4 sm:p-6">
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleSubmit)}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="serial"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Número de Serie</FormLabel>
                    <FormControl>
                      <div className="grid grid-cols-[52%_1fr] gap-2 sm:flex">
                        <div className="relative min-w-0 sm:flex-1">
                          <Input
                            placeholder="IOT-XXXX-XXXX"
                            {...field}
                            className="font-mono uppercase"
                            onChange={(e) => {
                              field.onChange(e.target.value.toUpperCase());
                              if (form.getFieldState("serial").invalid) {
                                form.clearErrors("serial");
                              }
                            }}
                            onBlur={() => {
                              field.onBlur();
                              checkDeviceSerial();
                            }}
                          />
                          {checking && (
                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                              <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent block"></span>
                            </div>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="min-w-0 px-2 sm:w-auto sm:px-4"
                          onClick={() => setScannerOpen(true)}
                        >
                          <QrCode className="h-4 w-4 shrink-0 mr-1 sm:mr-2" />
                          <span className="truncate">Escanear QR</span>
                        </Button>
                      </div>
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
                    <FormLabel>Nombre del servicio</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Ej: Agua caliente, Café, Lavado"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="environmentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Establecimiento</FormLabel>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <div className="flex-1">
                        <SearchableSelect
                          options={environments.map((env) => ({
                            label: env.name,
                            value: env.id,
                          }))}
                          value={field.value}
                          selectedLabel={selectedEnvironmentLabel}
                          onChange={(value) => {
                            field.onChange(value);
                            setSelectedEnvironmentLabel(
                              environments.find((env) => env.id === value)?.name,
                            );
                          }}
                          onSearchChange={environmentSearch.setValue}
                          shouldFilter={false}
                          isLoading={isLoadingEnvs}
                          placeholder="Seleccionar establecimiento"
                          disabled={isLoadingEnvs && environments.length === 0}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setEnvironmentDialogOpen(true)}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Nuevo establecimiento
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex gap-2 pt-4 sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 sm:flex-none"
                  onClick={() => navigate("/app/devices")}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  className="flex-1 sm:flex-none"
                  disabled={
                    pairDevice.isPending || checking || !form.formState.isValid
                  }
                >
                  {pairDevice.isPending && (
                    <span className="mr-2 animate-spin">⏳</span>
                  )}
                  Asociar
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </PageHeader>

      <Dialog open={environmentDialogOpen} onOpenChange={setEnvironmentDialogOpen}>
        <DialogContent className="max-w-[95vw] overflow-y-auto lg:max-w-6xl xl:max-w-7xl max-h-[92dvh]">
          <DialogHeader>
            <DialogTitle>Nuevo Establecimiento</DialogTitle>
            <DialogDescription>
              Completá los datos del establecimiento. Al guardarlo, quedará
              preseleccionado para asociar el dispositivo.
            </DialogDescription>
          </DialogHeader>
          <EnvironmentForm
            onSubmit={handleCreateEnvironment}
            isSubmitting={createEnvironment.isPending}
            onCancel={() => setEnvironmentDialogOpen(false)}
            submitLabel="Crear Establecimiento"
            cancelLabel="Cancelar"
          />
        </DialogContent>
      </Dialog>

      <Dialog open={scannerOpen} onOpenChange={setScannerOpen}>
        <DialogContent className="max-w-[90vw] sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Escanear QR</DialogTitle>
            <DialogDescription>
              Apuntá la cámara al código QR impreso en el dispositivo.
            </DialogDescription>
          </DialogHeader>
          {scannerOpen && (
            <QrScannerView onDecode={handleScanResult} onError={handleScanError} />
          )}
          <Button variant="outline" onClick={() => setScannerOpen(false)}>
            Cancelar
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
