import { FormPageLayout } from "@/components/custom/FormPageLayout";
import { DeviceForm } from "@/app/components/devices/DeviceForm";
import { useCreateDevice } from "@/app/hooks/useDevices";
import type { DeviceCreate } from "@/app/types/device.types";

export default function CreateDevicePage() {
  const createDevice = useCreateDevice();

  return (
    <FormPageLayout
      title="Nuevo Dispositivo"
      subtitle="Registra un nuevo dispositivo."
      backUrl="/admin/devices"
    >
      <DeviceForm
        isLoading={createDevice.isPending}
        onSubmit={(data) => createDevice.mutate(data as DeviceCreate)}
      />
    </FormPageLayout>
  );
}
