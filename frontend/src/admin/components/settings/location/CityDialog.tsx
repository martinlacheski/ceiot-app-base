/* eslint-disable @typescript-eslint/no-explicit-any */
import { useForm, useWatch } from "react-hook-form";
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
  createCityAction,
  updateCityAction,
} from "@/admin/actions/location.actions";
import type { City } from "@/interfaces/location.interface";

const schema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  postal_code: z.string().min(1, "El CP es requerido"),
  is_active: z.boolean().default(true),
});

type FormData = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: City | null;
  stateId?: string;
}

export function CityDialog({ open, onOpenChange, item, stateId }: Props) {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: {
      name: item?.name || "",
      postal_code: item?.postal_code || "",
      is_active: item?.is_active ?? true,
    },
  });

  const createMutation = useMutation({
    mutationFn: createCityAction,
    onSuccess: () => {
      toast.success("Ciudad creada");
      queryClient.invalidateQueries({ queryKey: ["cities", stateId] });
      onOpenChange(false);
    },
    onError: () => toast.error("Error al crear"),
  });

  const updateMutation = useMutation({
    mutationFn: updateCityAction,
    onSuccess: () => {
      toast.success("Ciudad actualizada");
      queryClient.invalidateQueries({ queryKey: ["cities", stateId] });
      onOpenChange(false);
    },
    onError: () => toast.error("Error al actualizar"),
  });

  const onSubmit = (data: FormData) => {
    if (!stateId) {
      toast.error("Error: No se ha seleccionado una provincia padre.");
      return;
    }
    if (item) {
      updateMutation.mutate({
        id: item.id,
        data: { ...data, state_id: stateId },
      });
    } else {
      createMutation.mutate({ ...data, state_id: stateId });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const isActive = useWatch({ control, name: "is_active" });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? "Editar Ciudad" : "Nueva Ciudad"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nombre</Label>
            <Input
              id="name"
              {...register("name")}
              placeholder="Ej. Guaymallén"
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="postal_code">Código Postal</Label>
            <Input
              id="postal_code"
              {...register("postal_code")}
              placeholder="Ej. 5519"
            />
            {errors.postal_code && (
              <p className="text-sm text-destructive">
                {errors.postal_code.message}
              </p>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="is_active"
              checked={isActive}
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
