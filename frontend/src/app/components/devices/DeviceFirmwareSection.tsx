import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HardDriveDownload } from "lucide-react";
import { toast } from "sonner";

import { firmwareKeys, firmwareService, getFirmwareErrorMessage } from "@/app/services/firmware.service";
import type { Device } from "@/app/types/device.types";
import { firmwareUpdatePollInterval, isFinalFirmwareUpdateState, type FirmwareUpdate } from "@/app/types/firmware.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { showConfirmDialog } from "@/store/confirm.store";
import { formatDateTime } from "@/utils/date.utils";
import { getFirmwareUpdateStateLabel } from "@/utils/status-labels";

const selectClass = "h-11 w-full rounded-md border border-input bg-background px-3 text-foreground sm:w-auto sm:min-w-48";

const stateVariant = (state: string) =>
  state === "succeeded" ? "default" : state === "failed" || state === "rolled_back" || state === "rejected" ? "destructive" : "secondary";

const attemptDetail = (attempt: FirmwareUpdate) =>
  attempt.errorMessage || (attempt.progress != null && !isFinalFirmwareUpdateState(attempt.state) ? `${attempt.progress}%` : "—");

interface DeviceFirmwareSectionProps {
  /** `firmwareVersion` is what the device last reported (`DeviceRead.firmware_version`). */
  device: Pick<Device, "id" | "brokerConnected"> & { firmwareVersion?: string | null };
  /** False keeps the queries idle (e.g. a closed dialog). */
  enabled?: boolean;
}

/** Admin-only: install an active firmware release on the device over the air and follow it. */
export function DeviceFirmwareSection({ device, enabled = true }: DeviceFirmwareSectionProps) {
  const queryClient = useQueryClient();
  const [chosenId, setChosenId] = useState<string>();
  const releases = useQuery({
    queryKey: firmwareKeys.activeReleases(),
    queryFn: () => firmwareService.listReleases({ active: true }),
    enabled,
  });
  const updates = useQuery({
    queryKey: firmwareKeys.deviceUpdates(device.id),
    queryFn: () => firmwareService.listUpdates(device.id),
    enabled,
    refetchInterval: (query) => firmwareUpdatePollInterval(query.state.data),
  });
  const start = useMutation({
    mutationFn: (releaseId: string) => firmwareService.startUpdate({ deviceId: device.id, releaseId }),
    onSuccess: () => {
      toast.success("Actualización de firmware solicitada");
      void queryClient.invalidateQueries({ queryKey: firmwareKeys.deviceUpdates(device.id) });
    },
    onError: (error) => toast.error(getFirmwareErrorMessage(error, "No se pudo iniciar la actualización")),
  });

  const available = releases.data ?? [];
  // The newest active release (the backend lists newest first) unless the admin picked another.
  const selected = available.find((release) => release.id === chosenId) ?? available[0];
  const currentVersion = device.firmwareVersion || null;
  const latest = updates.data?.[0];
  const inProgress = Boolean(latest && !isFinalFirmwareUpdateState(latest.state));

  const blockedReason = !releases.isSuccess
    ? null
    : !selected
      ? "No hay versiones de firmware activas."
      : device.brokerConnected === false
        ? "El dispositivo está sin conexión."
        : inProgress
          ? "Hay una actualización en curso."
          : selected.version === currentVersion
            ? "El dispositivo ya tiene esta versión."
            : null;
  const canStart = Boolean(selected) && blockedReason === null && !start.isPending;

  const confirmStart = () => {
    if (!selected || !canStart) return;
    const from = currentVersion ? ` de la versión ${currentVersion}` : "";
    showConfirmDialog(`¿Actualizar el firmware del dispositivo${from} a la ${selected.version}?`, async () => {
      await start.mutateAsync(selected.id).catch(() => undefined);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Firmware</CardTitle>
        <CardDescription>Actualización del firmware por internet (OTA).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm font-medium">Versión actual</p>
            <p className="text-sm text-muted-foreground"><span>{currentVersion ?? "Desconocida"}</span></p>
          </div>
          <div className="space-y-2">
            <label htmlFor={`firmware-release-${device.id}`} className="text-sm font-medium">Versión a instalar</label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <select
                id={`firmware-release-${device.id}`}
                className={selectClass}
                value={selected?.id ?? ""}
                disabled={!available.length}
                onChange={(event) => setChosenId(event.target.value)}
              >
                {available.length ? available.map((release) => <option key={release.id} value={release.id}>{release.version}</option>) : <option value="">—</option>}
              </select>
              <Button type="button" className="h-11" disabled={!canStart} onClick={confirmStart}>
                <HardDriveDownload data-icon="inline-start" />
                Actualizar firmware
              </Button>
            </div>
            {releases.isError && <p className="text-sm text-destructive">No se pudo cargar las versiones de firmware.</p>}
            {blockedReason && <p className="text-sm text-muted-foreground">{blockedReason}</p>}
          </div>
        </div>

        {latest && (
          <div className="space-y-2 rounded-md border p-3" data-testid="firmware-latest-attempt">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">Última actualización: {latest.targetVersion}</span>
              <Badge variant={stateVariant(latest.state)}>{getFirmwareUpdateStateLabel(latest.state)}</Badge>
              <span className="text-muted-foreground">{formatDateTime(latest.updatedAt ?? latest.createdAt)}</span>
            </div>
            {inProgress && latest.progress != null && (
              <div role="progressbar" aria-label="Progreso de la actualización" aria-valuemin={0} aria-valuemax={100} aria-valuenow={latest.progress} className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${latest.progress}%` }} />
              </div>
            )}
            {latest.errorMessage && <p className="text-sm text-destructive">{latest.errorMessage}</p>}
          </div>
        )}

        {updates.data && updates.data.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  {["Fecha", "Versión", "Estado", "Detalle"].map((title) => <TableHead key={title} className="text-center">{title}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {updates.data.map((attempt) => (
                  <TableRow key={attempt.id}>
                    <TableCell className="text-center">{formatDateTime(attempt.createdAt)}</TableCell>
                    <TableCell className="text-center">{attempt.targetVersion}</TableCell>
                    <TableCell className="text-center">{getFirmwareUpdateStateLabel(attempt.state)}</TableCell>
                    <TableCell className="text-center whitespace-normal">{attemptDetail(attempt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
