import { useLivePulseStatus } from "./livePulse.store";

/** Small "En vivo" marker, visible only while the live pulse stream is open. */
export function LiveIndicator() {
  const connected = useLivePulseStatus((state) => state.connected);
  if (!connected) return null;
  return (
    <span
      title="Actualizando en tiempo real"
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
    >
      <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
      En vivo
    </span>
  );
}
