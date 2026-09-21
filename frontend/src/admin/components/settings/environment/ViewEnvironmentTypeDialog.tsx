import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EnvironmentType } from "@/interfaces/environment.interface";

interface ViewEnvironmentTypeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  environmentType: EnvironmentType;
}

export function ViewEnvironmentTypeDialog({
  open,
  onOpenChange,
  environmentType,
}: ViewEnvironmentTypeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Detalles del Tipo de Establecimiento</DialogTitle>
        </DialogHeader>
        <div className="flex flex-row items-center justify-between gap-4 py-4">
          <div className="flex-[0.7] space-y-2">
            <Label>Nombre</Label>
            <Input value={environmentType.name} readOnly className="bg-muted" />
          </div>

          <div className="flex-[0.3] space-y-2">
            <Label>Estado</Label>
            <div className="flex items-center h-10">
              <Badge
                variant={environmentType.is_active ? "default" : "secondary"}
              >
                {environmentType.is_active ? "Activo" : "Inactivo"}
              </Badge>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
