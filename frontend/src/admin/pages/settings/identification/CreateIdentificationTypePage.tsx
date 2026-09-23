import { BackButton } from "@/components/custom/BackButton";
import { IdentificationTypeForm } from "@/admin/components/settings/identification/IdentificationTypeForm";

export function CreateIdentificationTypePage() {
  return (
    <div className="space-y-6">
      <div className="flex gap-4 sm:flex-row">
        <BackButton to="/admin/identification-types" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Nuevo Tipo de Documento
          </h1>
          <p className="text-muted-foreground">
            Crea un nuevo tipo de documento para el sistema.
          </p>
        </div>
      </div>

      <div className="rounded-lg border bg-card text-card-foreground p-6">
        <IdentificationTypeForm />
      </div>
    </div>
  );
}
