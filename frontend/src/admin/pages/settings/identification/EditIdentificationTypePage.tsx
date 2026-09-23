import { BackButton } from "@/components/custom/BackButton";
import { useParams } from "react-router";
import { Loader2 } from "lucide-react";

import { IdentificationTypeForm } from "@/admin/components/settings/identification/IdentificationTypeForm";
import { useIdentificationType } from "@/admin/hooks/useIdentification";

export function EditIdentificationTypePage() {
  const { id } = useParams<{ id: string }>();
  const { data: item, isLoading, isError } = useIdentificationType(id!);

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError || !item) {
    return <div>Error al cargar el tipo de documento</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-4 sm:flex-row">
        <BackButton to="/admin/identification-types" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Editar Tipo de Documento
          </h1>
          <p className="text-muted-foreground">
            Modifica los datos del tipo de documento seleccionado.
          </p>
        </div>
      </div>

      <div className="rounded-lg border bg-card text-card-foreground p-6">
        <IdentificationTypeForm initialData={item} />
      </div>
    </div>
  );
}
