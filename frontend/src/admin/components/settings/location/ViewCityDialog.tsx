import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { City } from "@/interfaces/location.interface";

interface ViewCityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  city: City;
}

export function ViewCityDialog({
  open,
  onOpenChange,
  city,
}: ViewCityDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Detalles de la Ciudad</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input value={city.name} readOnly className="bg-muted" />
            </div>
            <div className="space-y-2">
              <Label>Código Postal</Label>
              <Input value={city.postal_code} readOnly className="bg-muted" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>País</Label>
              <Input
                value={city.state?.country?.name || "-"}
                readOnly
                className="bg-muted"
              />
            </div>
            <div className="space-y-2">
              <Label>Provincia</Label>
              <Input
                value={city.state?.name || "-"}
                readOnly
                className="bg-muted"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Estado</Label>
            <div className="flex items-center h-10">
              <Badge variant={city.is_active ? "default" : "secondary"}>
                {city.is_active ? "Activo" : "Inactivo"}
              </Badge>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
