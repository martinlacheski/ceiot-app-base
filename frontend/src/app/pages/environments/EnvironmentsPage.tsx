import { useNavigate } from "react-router";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/app/components/PageHeader";
import { EnvironmentsTable } from "@/app/components/environments/EnvironmentsTable";

export function EnvironmentsPage() {
  const navigate = useNavigate();

  return (
    <div>
      <PageHeader
        title="Establecimientos"
        subtitle="Gestiona los establecimientos donde se encuentran tus dispositivos"
      >
        <EnvironmentsTable
          actions={
            <Button onClick={() => navigate("/app/environments/create")}>
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Establecimiento
            </Button>
          }
        />
      </PageHeader>
    </div>
  );
}
