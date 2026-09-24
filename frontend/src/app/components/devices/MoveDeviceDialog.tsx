import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/custom/SearchableSelect";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useMoveDevice } from "@/app/hooks/useDevices";
import { useEnvironments } from "@/app/hooks/useEnvironments";
import { useAuthStore } from "@/auth/store/auth.store";
import type { Device } from "@/app/types/device.types";
import type { Environment } from "@/app/types/environment.types";

const SEARCH_DEBOUNCE_MS = 300;
const DESTINATIONS_PER_PAGE = 50;

interface MoveDeviceDialogProps {
  device: Device;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MoveDeviceDialog({
  device,
  open,
  onOpenChange,
}: MoveDeviceDialogProps) {
  const [submitting, setSubmitting] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && submitting) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <MoveDeviceDialogBody
          device={device}
          submitting={submitting}
          onSubmittingChange={setSubmitting}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

interface MoveDeviceDialogBodyProps {
  device: Device;
  submitting: boolean;
  onSubmittingChange: (submitting: boolean) => void;
  onClose: () => void;
}

// Mounted only while the dialog is open: the establishments are fetched (and
// the selected destination reset) each time it opens.
function MoveDeviceDialogBody({
  device,
  submitting,
  onSubmittingChange,
  onClose,
}: MoveDeviceDialogBodyProps) {
  const user = useAuthStore((state) => state.user);
  const moveDevice = useMoveDevice();
  // The chosen destination is kept as an object: it must survive a new search
  // whose results no longer list it.
  const [destination, setDestination] = useState<Environment | undefined>();
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput.trim(), SEARCH_DEBOUNCE_MS);

  const isAdmin = !!user?.isAdmin;

  // The server filters by ownership (a normal user only gets their own
  // establishments; an admin sees every one) and by the typed term.
  const { data: environmentsData, isLoading } = useEnvironments({
    page: 1,
    perPage: DESTINATIONS_PER_PAGE,
    isActive: true,
    sortBy: "name",
    sortOrder: "asc",
    ownerId: isAdmin ? undefined : user?.id,
    search: search || undefined,
  });

  // The ownership check stays as a safety net on top of the server filter.
  const destinations: Environment[] = (environmentsData?.items ?? []).filter(
    (env) =>
      env.id !== device.environmentId && (isAdmin || env.ownerId === user?.id),
  );
  const isSearching = searchInput !== "" || search !== "";
  const originName = device.environment?.name ?? "el establecimiento actual";

  const getOptionLabel = (env: Environment) =>
    isAdmin && env.ownerName ? `${env.name} — ${env.ownerName}` : env.name;

  const handleConfirm = async () => {
    if (!destination) return;

    onSubmittingChange(true);
    try {
      await moveDevice.mutateAsync({
        id: device.id,
        data: { environmentId: destination.id },
      });
      onClose();
    } catch {
      // The mutation already showed the backend detail; keep the dialog open.
    } finally {
      onSubmittingChange(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Mover dispositivo a otro establecimiento</DialogTitle>
        <DialogDescription>
          {device.name} está actualmente en {originName}. Elegí el
          establecimiento al que querés moverlo.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {!isLoading && !isSearching && destinations.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            No tenés otros establecimientos para mover este dispositivo
          </p>
        ) : (
          <SearchableSelect
            options={destinations.map((env) => ({
              label: getOptionLabel(env),
              value: env.id,
            }))}
            value={destination?.id}
            selectedLabel={destination ? getOptionLabel(destination) : undefined}
            onChange={(id) =>
              setDestination(destinations.find((env) => env.id === id))
            }
            onSearchChange={setSearchInput}
            shouldFilter={false}
            isLoading={isLoading}
            emptyMessage="No se encontraron establecimientos"
            placeholder="Seleccionar establecimiento destino"
            disabled={submitting || (isLoading && !isSearching)}
          />
        )}

        {destination && (
          <div className="space-y-2 text-sm">
            <p className="font-medium">Qué va a pasar</p>
            <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
              <li>
                {`Los invitados propios de este dispositivo se quitarán. Si ${destination.name} tiene invitados, tendrán acceso automáticamente.`}
              </li>
              <li>
                {`El historial ya registrado (operaciones y telemetría) queda en ${originName}; la actividad nueva se registrará en ${destination.name}.`}
              </li>
            </ul>
          </div>
        )}
      </div>

      <DialogFooter className="gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={submitting}
        >
          Volver
        </Button>
        <Button
          type="button"
          onClick={handleConfirm}
          disabled={!destination || submitting}
        >
          {submitting ? "Moviendo..." : "Mover dispositivo"}
        </Button>
      </DialogFooter>
    </>
  );
}
