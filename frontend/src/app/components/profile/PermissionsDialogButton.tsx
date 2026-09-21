import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DialogClose,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ShieldAlert } from "lucide-react";

interface PermissionsDialogButtonProps {
  permissions: string[];
  triggerLabel?: string;
  className?: string;
}

export function PermissionsDialogButton({
  permissions,
  triggerLabel = "Ver permisos",
  className,
}: PermissionsDialogButtonProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("w-fit", className)}
        >
          <ShieldAlert data-icon="inline-start" />
          {triggerLabel}
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Permisos de acceso</DialogTitle>
          <DialogDescription>
            Permisos efectivos del usuario autenticado.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[55dvh] pr-3">
          <div className="flex flex-wrap gap-2">
            {permissions.map((permission) => (
              <Badge key={permission} variant="secondary" className="break-all">
                {permission}
              </Badge>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cerrar
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
