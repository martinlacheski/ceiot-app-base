/* eslint-disable react-hooks/incompatible-library */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useNavigate } from "react-router";
import { useForm } from "react-hook-form";
import { Loader2 } from "lucide-react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { EnvironmentType } from "@/interfaces/environment.interface";
import {
  useCreateEnvironmentType,
  useUpdateEnvironmentType,
} from "@/admin/hooks/useEnvironment";
import { showConfirmDialog } from "@/store/confirm.store";
import { toast } from "sonner";
import {
  FULL_PAGE_FORM_ACTION_BUTTON_CLASS,
  FULL_PAGE_FORM_ACTIONS_CLASS,
  FULL_PAGE_FORM_BACK_LABEL,
  getFullPageFormPrimaryLabel,
} from "@/components/custom/fullPageFormActions";

const CREATE_ENVIRONMENT_TYPE_LABEL = "Crear Tipo de Establecimiento";

const schema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  is_active: z.boolean(),
});

type FormData = z.infer<typeof schema>;

interface Props {
  initialData?: EnvironmentType;
}

export function EnvironmentTypeForm({ initialData }: Props) {
  const navigate = useNavigate();
  const createMutation = useCreateEnvironmentType();
  const updateMutation = useUpdateEnvironmentType();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: {
      name: initialData?.name || "",
      is_active: initialData?.is_active ?? true,
    },
  });

  const onSubmit = async (data: FormData) => {
    try {
      if (initialData) {
        await updateMutation.mutateAsync({ id: initialData.id, data });
        toast.success("Tipo de establecimiento actualizado");
      } else {
        await createMutation.mutateAsync(data);
        toast.success("Tipo de establecimiento creado");
      }
      navigate("/admin/environments/types");
    } catch (error) {
      toast.error("Error al guardar, error: " + error);
    }
  };

  const handleFormSubmit = (data: FormData) => {
    showConfirmDialog(
      initialData
        ? "¿Estás seguro de actualizar este tipo de establecimiento?"
        : "¿Estás seguro de crear este tipo de establecimiento?",
      () => onSubmit(data)
    );
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const primaryLabel = getFullPageFormPrimaryLabel(
    initialData ? "edit" : "create",
    CREATE_ENVIRONMENT_TYPE_LABEL,
  );

  return (
    <form
      onSubmit={handleSubmit(handleFormSubmit)}
      className="w-full min-w-0 space-y-6"
    >
      <div
        className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-[minmax(0,3fr)_auto] md:items-end"
        data-testid="environment-type-fields"
      >
        <div className="min-w-0 space-y-2">
          <Label htmlFor="name">Nombre</Label>
          <Input
            id="name"
            {...register("name")}
            placeholder="Ingrese el nombre del tipo de establecimiento"
            className="w-full min-w-0"
          />
          {errors.name && (
            <p className="text-sm text-destructive">{errors.name.message}</p>
          )}
        </div>

        <div className="flex h-11 shrink-0 items-center gap-2 md:justify-end">
          <Switch
            id="is_active"
            checked={watch("is_active")}
            onCheckedChange={(checked) => setValue("is_active", checked)}
          />
          <Label htmlFor="is_active">Activo</Label>
        </div>
      </div>

      <div
        className={FULL_PAGE_FORM_ACTIONS_CLASS}
        data-testid="form-actions"
      >
        <Button
          type="button"
          variant="outline"
          className={FULL_PAGE_FORM_ACTION_BUTTON_CLASS}
          onClick={() => navigate("/admin/environments/types")}
        >
          {FULL_PAGE_FORM_BACK_LABEL}
        </Button>
        <Button
          type="submit"
          className={FULL_PAGE_FORM_ACTION_BUTTON_CLASS}
          disabled={isPending}
          aria-label={primaryLabel}
        >
          {isPending && (
            <Loader2 aria-hidden="true" data-icon="inline-start" className="animate-spin" />
          )}
          {initialData ? (
            primaryLabel
          ) : (
            <>
              <span aria-hidden="true" className="sm:hidden">
                Crear Tipo
              </span>
              <span aria-hidden="true" className="hidden sm:inline">
                {primaryLabel}
              </span>
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
