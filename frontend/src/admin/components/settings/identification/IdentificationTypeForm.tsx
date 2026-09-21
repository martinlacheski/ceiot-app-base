import { useNavigate } from "react-router";
import { useForm, useWatch } from "react-hook-form";
import { Loader2 } from "lucide-react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import {
  FULL_PAGE_FORM_ACTION_BUTTON_CLASS,
  FULL_PAGE_FORM_ACTIONS_CLASS,
  FULL_PAGE_FORM_BACK_LABEL,
  getFullPageFormPrimaryLabel,
} from "@/components/custom/fullPageFormActions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { IdentificationType } from "@/interfaces/identification.interface";
import {
  useCreateIdentificationType,
  useUpdateIdentificationType,
} from "@/admin/hooks/useIdentification";
import { showConfirmDialog } from "@/store/confirm.store";
import { toast } from "sonner";

const CREATE_IDENTIFICATION_TYPE_LABEL = "Crear Tipo de Documento";

const schema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  is_active: z.boolean(),
});

type FormData = z.infer<typeof schema>;

interface Props {
  initialData?: IdentificationType;
  isCustomizing?: boolean;
}

export function IdentificationTypeForm({ initialData }: Props) {
  const primaryLabel = getFullPageFormPrimaryLabel(
    initialData ? "edit" : "create",
    CREATE_IDENTIFICATION_TYPE_LABEL,
  );
  const navigate = useNavigate();
  const createMutation = useCreateIdentificationType();
  const updateMutation = useUpdateIdentificationType();

  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: initialData?.name || "",
      is_active: initialData?.is_active ?? true,
    },
  });

  const onSubmit = async (data: FormData) => {
    try {
      if (initialData) {
        await updateMutation.mutateAsync({ id: initialData.id, data });
        toast.success("Tipo de documento actualizado");
      } else {
        await createMutation.mutateAsync(data);
        toast.success("Tipo de documento creado");
      }
      navigate("/admin/identification-types");
    } catch (error) {
      toast.error("Error al guardar, error: " + error);
    }
  };

  const handleFormSubmit = (data: FormData) => {
    showConfirmDialog(
      initialData
        ? "¿Estás seguro de actualizar este tipo de documento?"
        : "¿Estás seguro de crear este tipo de documento?",
      () => onSubmit(data),
    );
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const isActive = useWatch({ control, name: "is_active" });

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="w-full md:flex-[0.7]">
          <div className="space-y-2">
            <Label htmlFor="name">Nombre</Label>
            <Input
              id="name"
              {...register("name")}
              placeholder="Ingrese el nombre del tipo de documento"
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>
        </div>

        <div className="w-full md:flex-[0.3]">
          <div className="flex flex-col gap-2">
            <Label htmlFor="is_active">Estado</Label>
            <div
              className="flex min-h-11 items-center gap-2"
              data-testid="identification-type-status"
            >
              <Switch
                id="is_active"
                checked={isActive}
                onCheckedChange={(checked) => setValue("is_active", checked)}
              />
              <span className="text-sm font-medium">
                {isActive ? "Activo" : "Inactivo"}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div
        className={`${FULL_PAGE_FORM_ACTIONS_CLASS} pt-4`}
        data-testid="form-actions"
      >
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate("/admin/identification-types")}
          disabled={isPending}
          className={FULL_PAGE_FORM_ACTION_BUTTON_CLASS}
        >
          {FULL_PAGE_FORM_BACK_LABEL}
        </Button>
        <Button
          type="submit"
          disabled={isPending}
          className={FULL_PAGE_FORM_ACTION_BUTTON_CLASS}
          aria-label={primaryLabel}
        >
          {isPending && (
            <Loader2
              aria-hidden="true"
              data-icon="inline-start"
              className="animate-spin"
            />
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
