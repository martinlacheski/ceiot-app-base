import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { State } from "@/interfaces/location.interface";

interface ViewStateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: State;
}

export function ViewStateDialog({
  open,
  onOpenChange,
  state,
}: ViewStateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Detalles de la Provincia</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input value={state.name} readOnly className="bg-muted" />
            </div>
            <div className="space-y-2">
              <Label>País</Label>
              <Input
                value={state.country?.name || "-"}
                readOnly
                className="bg-muted"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Estado</Label>
            <div className="flex items-center h-10">
              <Badge variant={state.is_active ? "default" : "secondary"}>
                {state.is_active ? "Activo" : "Inactivo"}
              </Badge>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
