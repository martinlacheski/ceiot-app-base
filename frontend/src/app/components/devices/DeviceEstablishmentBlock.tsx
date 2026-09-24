import { useState } from "react";
import { ArrowRightLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MoveDeviceDialog } from "@/app/components/devices/MoveDeviceDialog";
import type { Device } from "@/app/types/device.types";

interface DeviceEstablishmentBlockProps {
  device: Device;
  /** Blocks opening the move dialog (e.g. while the edit form has unsaved changes). */
  moveDisabled?: boolean;
}

/**
 * Shows the establishment a paired device belongs to and the action to move it
 * to another one. It is independent from the edit form: it never submits it.
 */
export function DeviceEstablishmentBlock({
  device,
  moveDisabled = false,
}: DeviceEstablishmentBlockProps) {
  const [open, setOpen] = useState(false);
  const environment = device.environment;

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-muted/50 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-muted-foreground">
          Establecimiento
        </p>
        <p className="truncate text-base font-semibold">
          {environment?.name ?? "-"}
        </p>
        {environment?.ownerName && (
          <p className="truncate text-sm text-muted-foreground">
            Propietario: {environment.ownerName}
          </p>
        )}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11"
        disabled={moveDisabled}
        onClick={() => setOpen(true)}
      >
        <ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" />
        Mover a otro establecimiento
      </Button>
      <MoveDeviceDialog device={device} open={open} onOpenChange={setOpen} />
    </div>
  );
}
