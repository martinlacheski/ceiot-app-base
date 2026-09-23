import { useNavigate } from "react-router";
import { Link as LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/app/components/PageHeader";
import { DevicesTable } from "@/app/components/devices/DevicesTable";
import { useAuthStore } from "@/auth/store/auth.store";

export default function UserDevicesPage() {
  const navigate = useNavigate();
  const isAdmin = useAuthStore((state) => state.isAdmin());

  return (
    <PageHeader
      title={isAdmin ? "Vista de Dispositivos" : "Mis Dispositivos"}
      subtitle={
        isAdmin
          ? "Buscá, filtrá y monitoreá la actividad de todos los dispositivos."
          : "Gestiona tus dispositivos vinculados y monitorea su actividad."
      }
    >
      <DevicesTable
        mode="user"
        actions={
          <Button onClick={() => navigate("/app/devices/pair")}>
            <LinkIcon className="mr-2 h-4 w-4" />
            Asociar Dispositivo
          </Button>
        }
      />
    </PageHeader>
  );
}
