import { useParams } from "react-router";
import { Loader2 } from "lucide-react";

import { EnvironmentTypeForm } from "@/admin/components/settings/environment/EnvironmentTypeForm";
import { useEnvironmentType } from "@/admin/hooks/useEnvironment";
import { FormPageLayout } from "@/components/custom/FormPageLayout";

export function EditEnvironmentTypePage() {
  const { id } = useParams();
  const { data: environmentType, isLoading, isError } = useEnvironmentType(id!);

  if (isLoading) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (isError) {
    return <div>Error al cargar el tipo de establecimiento</div>;
  }

  return (
    <FormPageLayout
      title="Editar Tipo de Establecimiento"
      subtitle="Modifica los datos del tipo de establecimiento seleccionado."
      backUrl="/admin/environments/types"
    >
      <EnvironmentTypeForm initialData={environmentType} />
    </FormPageLayout>
  );
}
