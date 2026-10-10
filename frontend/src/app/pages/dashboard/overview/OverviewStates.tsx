import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export type InventoryLabel = "establecimientos" | "dispositivos";

export function LoadingState({ label, rows = 2 }: { label: InventoryLabel; rows?: number }) {
  return (
    <div role="status" aria-label={`Cargando ${label}`} className="space-y-3">
      {Array.from({ length: rows }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}
    </div>
  );
}

/** Compact inline alert with a retry scoped to one inventory. */
export function ErrorState({ label, onRetry }: { label: InventoryLabel; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 px-4 py-2">
      <p className="text-sm text-destructive">No pudimos cargar los {label}.</p>
      <Button variant="outline" size="sm" onClick={onRetry} aria-label={`Reintentar ${label}`}>
        Reintentar
      </Button>
    </div>
  );
}

/**
 * Shown only when a background refresh failed. Successful background refreshes
 * stay silent: the data simply updates in place.
 */
export function RefreshErrorNotice({ hasError }: { hasError: boolean }) {
  if (!hasError) return null;
  return (
    <p role="status" className="text-xs text-destructive">
      No se pudo actualizar el inventario. Se muestran los últimos datos disponibles.
    </p>
  );
}
