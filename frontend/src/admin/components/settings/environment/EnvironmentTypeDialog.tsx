/* eslint-disable react-hooks/incompatible-library */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useForm } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  createEnvironmentTypeAction,
  updateEnvironmentTypeAction,
} from "@/admin/actions/environment.actions";
import type { EnvironmentType } from "@/interfaces/environment.interface";

const schema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  is_active: z.boolean().default(true),
});

type FormData = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: EnvironmentType | null;
}

export function EnvironmentTypeDialog({ open, onOpenChange, item }: Props) {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: {
      name: item?.name || "",
      is_active: item?.is_active ?? true,
    },
  });

  const createMutation = useMutation({
    mutationFn: createEnvironmentTypeAction,
    onSuccess: () => {
      toast.success("Tipo de establecimiento creado");
      queryClient.invalidateQueries({ queryKey: ["environment-types"] });
      onOpenChange(false);
    },
    onError: () => toast.error("Error al crear"),
  });

  const updateMutation = useMutation({
    mutationFn: updateEnvironmentTypeAction,
    onSuccess: () => {
      toast.success("Tipo de establecimiento actualizado");
      queryClient.invalidateQueries({ queryKey: ["environment-types"] });
      onOpenChange(false);
    },
    onError: () => toast.error("Error al actualizar"),
  });

  const onSubmit = (data: FormData) => {
    if (item) {
      updateMutation.mutate({ id: item.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {item
              ? "Editar Tipo de Establecimiento"
              : "Nuevo Tipo de Establecimiento"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nombre</Label>
            <Input id="name" {...register("name")} placeholder="Ej. Oficina" />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="is_active"
              checked={watch("is_active")}
              onCheckedChange={(checked) => setValue("is_active", checked)}
            />
            <Label htmlFor="is_active">Activo</Label>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
