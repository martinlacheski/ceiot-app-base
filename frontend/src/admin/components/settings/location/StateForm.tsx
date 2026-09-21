import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useCountries } from "@/admin/hooks/useLocations";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { showConfirmDialog } from "@/store/confirm.store";
import { Loader2 } from "lucide-react";

const schema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  country_id: z.string().min(1, "El país es requerido"),
  is_active: z.boolean(),
});

export type StateFormValues = z.infer<typeof schema>;

interface Props {
  defaultValues?: Partial<StateFormValues>;
  onSubmit: (data: StateFormValues) => void;
  isSubmitting?: boolean;
  onCancel?: () => void;
  mode: FullPageFormMode;
}

export function StateForm({
  defaultValues,
  onSubmit,
  isSubmitting,
  onCancel,
  mode,
}: Props) {
  const primaryLabel = getFullPageFormPrimaryLabel(mode, "Crear Provincia");
  const form = useForm<StateFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: defaultValues?.name || "",
      country_id: defaultValues?.country_id || "",
      is_active: defaultValues?.is_active ?? true,
      ...defaultValues,
    },
  });

  const handleSubmit = (data: StateFormValues) => {
    showConfirmDialog(
      defaultValues?.name
        ? "¿Estás seguro de actualizar esta provincia?"
        : "¿Estás seguro de crear esta provincia?",
      () => onSubmit(data)
    );
  };

  const { data: countriesResponse } = useCountries({
    page: 1,
    size: 100, // Fetch enough countries for selection, ideally specific endpoint or search
    isActive: true,
  });

  const countries = countriesResponse?.items || [];

  // Reset logic removed in favor of key-based re-initialization

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <FormField
            control={form.control}
            name="country_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>País</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                  value={field.value}
                >
                  <FormControl>
                    <SelectTrigger className="h-10 w-full">
                      <SelectValue placeholder="Selecciona un país" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {countries.map((country: { id: string; name: string }) => (
                      <SelectItem key={country.id} value={country.id}>
                        {country.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nombre</FormLabel>
                <FormControl>
                  <Input
                    className="h-10"
                    placeholder="Ingrese el nombre de la provincia"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="is_active"
            render={({ field }) => (
              <FormItem>
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

        <div className={FULL_PAGE_FORM_ACTIONS_CLASS} data-testid="form-actions">
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
