import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { User } from "@/interfaces/user.interface";
import { Calendar, Mail, Phone, Shield, UserIcon } from "lucide-react";

type ViewUserDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User;
};

export function ViewUserDialog({
  open,
  onOpenChange,
  user,
}: ViewUserDialogProps) {
  const formatDate = (dateString: string) => {
    // Append T12:00:00 to prevent timezone shift when parsing YYYY-MM-DD
    return new Date(`${dateString}T12:00:00`).toLocaleDateString("es-ES", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px]">
        <DialogHeader>
          <DialogTitle>Detalles del usuario</DialogTitle>
          <DialogDescription>
            Información completa del usuario seleccionado
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 py-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Row 1: Nombre Completo | Email */}
            <div className="flex items-center gap-3">
              <UserIcon className="size-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Nombre completo
                </p>
                <p className="text-base font-medium">
                  {user.firstName} {user.lastName}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Mail className="size-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Email
                </p>
                <p className="text-base">{user.email}</p>
              </div>
            </div>

            {/* Row 2: Usuario | DNI */}
            <div className="flex items-center gap-3">
              <UserIcon className="size-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Usuario
                </p>
                <p className="text-base">{user.username}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Shield className="size-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">DNI</p>
                <p className="text-base">{user.identificationNumber || "-"}</p>
              </div>
            </div>

            {/* Row 3: Fecha de Nacimiento | Telefono */}
            <div className="flex items-center gap-3">
              <Calendar className="size-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Fecha de nacimiento
                </p>
                <p className="text-base">
                  {user.birthDate ? formatDate(user.birthDate) : "-"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Phone className="size-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Teléfono
                </p>
                <p className="text-base">{user.phone || "-"}</p>
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border p-4">
            <h3 className="font-medium">Estado</h3>
            <div className="flex flex-wrap gap-2">
              <Badge variant={user.isActive ? "default" : "secondary"}>
                {user.isActive ? "Activo" : "Inactivo"}
              </Badge>
              <Badge variant={user.isAdmin ? "destructive" : "outline"}>
                {user.isAdmin ? "Administrador" : "Usuario"}
              </Badge>
              {user.isSocialAuth && (
                <Badge variant="outline">Auth social</Badge>
              )}
            </div>
          </div>

          {user.permissions && user.permissions.length > 0 && (
            <div className="space-y-3 rounded-lg border p-4">
              <h3 className="font-medium">Permisos</h3>
              <div className="flex flex-wrap gap-2">
                {user.permissions.map((permission) => (
                  <Badge key={permission} variant="secondary">
                    {permission}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
