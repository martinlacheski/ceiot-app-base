import { IdentificationTypeForm } from "@/admin/components/settings/identification/IdentificationTypeForm";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";

export function CreateIdentificationTypePage() {
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
            Nuevo Tipo de Documento
          </h1>
          <p className="text-muted-foreground">
            Crea un nuevo tipo de documento para el sistema.
          </p>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-6">
        <IdentificationTypeForm />
      </div>
    </div>
  );
}
