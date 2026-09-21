import { useNavigate } from "react-router";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/app/components/PageHeader";
import { DevicesTable } from "@/app/components/devices/DevicesTable";

export default function DevicesPage() {
  const navigate = useNavigate();

  return (
    <PageHeader title="Dispositivos" subtitle="Gestiona los dispositivos IoT">
      <DevicesTable
        actions={
          <Button onClick={() => navigate("/admin/devices/create")}>
            <Plus className="mr-2 h-4 w-4" />
            Nuevo Dispositivo
          </Button>
        }
      />
    </PageHeader>
  );
}
