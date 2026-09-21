import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { IdentificationType } from "@/interfaces/identification.interface";

interface ViewIdentificationTypeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  identificationType: IdentificationType;
}

export function ViewIdentificationTypeDialog({
  open,
  onOpenChange,
  identificationType,
}: ViewIdentificationTypeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Detalles del Tipo de Documento</DialogTitle>
        </DialogHeader>
        <div className="flex flex-row items-center justify-between gap-4 py-4">
          <div className="flex-[0.7] space-y-2">
            <Label>Nombre</Label>
            <Input
              value={identificationType.name}
              readOnly
              className="bg-muted"
            />
          </div>

          <div className="flex-[0.3] space-y-2">
            <Label>Estado</Label>
            <div className="flex items-center h-10">
              <Badge
                variant={identificationType.is_active ? "default" : "secondary"}
              >
                {identificationType.is_active ? "Activo" : "Inactivo"}
              </Badge>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
