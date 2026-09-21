import { EnvironmentTypeForm } from "@/admin/components/settings/environment/EnvironmentTypeForm";
import { FormPageLayout } from "@/components/custom/FormPageLayout";

export function CreateEnvironmentTypePage() {
  return (
    <FormPageLayout
      title="Nuevo Tipo de Establecimiento"
      subtitle="Registra un nuevo tipo de establecimiento."
      backUrl="/admin/environments/types"
    >
      <EnvironmentTypeForm />
    </FormPageLayout>
  );
}
