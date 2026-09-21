import { useParams, Link } from "react-router";
import { Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

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
        <Button variant="outline" size="icon" asChild>
          <Link to="/admin/identification-types">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Editar Tipo de Documento
          </h1>
          <p className="text-muted-foreground">
            Modifica los datos del tipo de documento seleccionado.
          </p>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-6">
        <IdentificationTypeForm initialData={item} />
      </div>
    </div>
  );
}
