export const UNSUPPORTED_DEVICE_TYPE_MESSAGE =
  "Tipo de dispositivo no soportado por esta pantalla";

export function UnsupportedDeviceTypePanel() {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-medium">{UNSUPPORTED_DEVICE_TYPE_MESSAGE}</p>
      <p className="mt-1">
        Los datos comunes permanecen visibles, pero esta pantalla no puede
        guardar campos específicos para el tipo seleccionado.
      </p>
    </div>
  );
}
