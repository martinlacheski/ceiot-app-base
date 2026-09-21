import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  FULL_PAGE_FORM_ACTION_BUTTON_CLASS,
  FULL_PAGE_FORM_ACTIONS_CLASS,
  FULL_PAGE_FORM_BACK_LABEL,
  getFullPageFormPrimaryLabel,
  type FullPageFormMode,
} from "@/components/custom/fullPageFormActions";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { showConfirmDialog } from "@/store/confirm.store";
import { Loader2 } from "lucide-react";

const schema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  is_active: z.boolean(),
});

export type CountryFormValues = z.infer<typeof schema>;

interface Props {
  defaultValues?: Partial<CountryFormValues>;
  onSubmit: (data: CountryFormValues) => void;
  isSubmitting?: boolean;
  onCancel?: () => void;
  mode: FullPageFormMode;
}

export function CountryForm({
  defaultValues,
  onSubmit,
  isSubmitting,
  onCancel,
  mode,
}: Props) {
  const primaryLabel = getFullPageFormPrimaryLabel(mode, "Crear País");
  const form = useForm<CountryFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      is_active: true,
      ...defaultValues,
    },
  });

  const handleSubmit = (data: CountryFormValues) => {
    showConfirmDialog(
      defaultValues?.name
        ? "¿Estás seguro de actualizar este país?"
        : "¿Estás seguro de crear este país?",
      () => onSubmit(data)
    );
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="md:flex-[0.7]">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ingrese el nombre del país"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="md:flex-[0.3]">
            <FormField
              control={form.control}
              name="is_active"
              render={({ field }) => (
                <FormItem className="flex flex-col gap-2">
                  <FormLabel>Estado</FormLabel>
                  <div className="flex min-h-11 items-center gap-2">
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <span className="text-sm font-medium">
                      {field.value ? "Activo" : "Inactivo"}
                    </span>
                  </div>
                </FormItem>
              )}
            />
          </div>
        </div>

        <div className={`${FULL_PAGE_FORM_ACTIONS_CLASS} pt-4`} data-testid="form-actions">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={isSubmitting}
              className={FULL_PAGE_FORM_ACTION_BUTTON_CLASS}
            >
              {FULL_PAGE_FORM_BACK_LABEL}
            </Button>
          )}
          <Button type="submit" disabled={isSubmitting} className={FULL_PAGE_FORM_ACTION_BUTTON_CLASS}>
            {isSubmitting && <Loader2 aria-hidden="true" data-icon="inline-start" className="animate-spin" />}
            {primaryLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
