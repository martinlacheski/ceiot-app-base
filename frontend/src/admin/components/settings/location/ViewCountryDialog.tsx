import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Country } from "@/interfaces/location.interface";

interface ViewCountryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  country: Country;
}

export function ViewCountryDialog({
  open,
  onOpenChange,
  country,
}: ViewCountryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Detalles del País</DialogTitle>
        </DialogHeader>
        <div className="flex flex-row items-center justify-between gap-4 py-4">
          <div className="flex-[0.7] space-y-2">
            <Label>Nombre</Label>
            <Input value={country.name} readOnly className="bg-muted" />
          </div>

          <div className="flex-[0.3] space-y-2">
            <Label>Estado</Label>
            <div className="flex items-center h-10">
              <Badge variant={country.is_active ? "default" : "secondary"}>
                {country.is_active ? "Activo" : "Inactivo"}
              </Badge>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
