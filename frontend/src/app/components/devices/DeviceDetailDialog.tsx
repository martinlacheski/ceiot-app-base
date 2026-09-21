import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  Activity,
  Clock,
  HardDrive,
  Hash,
  MapPin,
} from "lucide-react";
import type { Device } from "@/app/types/device.types";
import { formatDeviceGpsSummary, formatDeviceMac } from "./deviceTelemetry";

interface DeviceDetailDialogProps {
  device: Device | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeviceDetailDialog({
  device,
  open,
  onOpenChange,
}: DeviceDetailDialogProps) {
  if (!device) return null;

  const DEVICE_STATUS_LABELS: Record<string, string> = {
    new: "NUEVO",
    paired: "VINCULADO",
    active: "ACTIVO",
    maintenance: "MANTENIMIENTO",
    unpaired: "DESVINCULADO",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>Detalles del Dispositivo</DialogTitle>
            <Badge variant={device.isActive ? "default" : "destructive"}>
              {device.isActive ? "ACTIVO" : "INACTIVO"}
            </Badge>
          </div>
        </DialogHeader>

        <div className="grid gap-6 py-4">
          {/* Header Info */}
          <div className="flex items-start justify-between border-b pb-4">
            <div>
              <h3 className="text-lg font-semibold">{device.name}</h3>
              <p className="text-sm text-muted-foreground">
                {device.description || "Sin descripción"}
              </p>
            </div>
            <div className="text-right">
              <div className="flex items-center justify-end gap-1 text-sm text-muted-foreground">
                <Hash className="size-4" />
                <span>{device.serial}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Modelo: {device.model || "-"}
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Status & Type */}
            <div className="space-y-4">
              <h4 className="font-medium flex items-center gap-2">
                <Activity className="size-4" /> Estado
              </h4>
              <div className="grid gap-2 text-sm">
                <div className="flex justify-between border-b pb-1">
                  <span className="text-muted-foreground">Tipo:</span>
                  <span>{device.type?.name || "-"}</span>
                </div>
                <div className="flex justify-between border-b pb-1">
                  <span className="text-muted-foreground">
                    Estado Operativo:
                  </span>
                  <span className="capitalize">
                    {DEVICE_STATUS_LABELS[device.status] || device.status}
                  </span>
                </div>
                <div className="flex justify-between border-b pb-1">
                  <span className="text-muted-foreground">Habilitado:</span>
                  <span>{device.enabled ? "Sí" : "No"}</span>
                </div>
                <div className="flex justify-between gap-4 border-b pb-1">
                  <span className="text-muted-foreground">MAC:</span>
                  <span className="text-right">{formatDeviceMac(device)}</span>
                </div>
              </div>
            </div>

            {/* Location / Environment */}
            <div className="space-y-4">
              <h4 className="font-medium flex items-center gap-2">
                <MapPin className="size-4" /> Ubicación
              </h4>
              <div className="grid gap-2 text-sm">
                <div className="flex justify-between border-b pb-1">
                  <span className="text-muted-foreground">
                    Establecimiento:
                  </span>
                  <span>{device.environment?.name || "Sin asignar"}</span>
                </div>
                <div className="flex justify-between gap-4 border-b pb-1">
                  <span className="text-muted-foreground">Último GPS:</span>
                  <span className="text-right">{formatDeviceGpsSummary(device)}</span>
                </div>
                {/* Could add more Env info if available in response */}
              </div>
            </div>

            {/* Manufacture Info */}
            <div className="space-y-4">
              <h4 className="font-medium flex items-center gap-2">
                <HardDrive className="size-4" /> Fabricación
              </h4>
              <div className="grid gap-2 text-sm">
                <div className="flex justify-between border-b pb-1">
                  <span className="text-muted-foreground">Lote:</span>
                  <span>{device.batch || "-"}</span>
                </div>
                <div className="flex justify-between border-b pb-1">
                  <span className="text-muted-foreground">
                    Fecha de Fabricación:
                  </span>
                  <span>
                    <span>
                      {(() => {
                        if (!device.manufactureDate) return "-";
                        // Fix off-by-one error by parsing manually yyyy-mm-dd
                        const [y, m, d] = device.manufactureDate
                          .split("-")
                          .map(Number);
                        // Month is 0-indexed in JS Date
                        const localDate = new Date(y, m - 1, d);

                        return format(localDate, "PPP", { locale: es });
                      })()}
                    </span>
                  </span>
                </div>
              </div>
            </div>

          </div>

          {/* Timestamps */}
          <div className="flex justify-between text-xs text-muted-foreground pt-4 border-t">
            {device.updatedAt && (
              <span className="flex items-center gap-1">
                <Clock className="size-3" />
                Actualizado:{" "}
                {format(new Date(device.updatedAt), "PP p", { locale: es })}
              </span>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
