import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useCountries, useStates } from "@/admin/hooks/useLocations";
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
import { useState } from "react";

const schema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  postal_code: z.string().min(1, "El CP es requerido"),
  state_id: z.string().min(1, "La provincia es requerida"),
  is_active: z.boolean(),
});

export type CityFormValues = z.infer<typeof schema>;

interface Props {
  defaultValues?: Partial<CityFormValues> & { country_id?: string };
  onSubmit: (data: CityFormValues) => void;
  isSubmitting?: boolean;
  onCancel?: () => void;
  mode: FullPageFormMode;
}

export function CityForm({
  defaultValues,
  onSubmit,
  isSubmitting,
  onCancel,
  mode,
}: Props) {
  const primaryLabel = getFullPageFormPrimaryLabel(mode, "Crear Ciudad");
  // Local state for country selection to filter states
  const [selectedCountryId, setSelectedCountryId] = useState<string>(
    defaultValues?.country_id || ""
  );

  const form = useForm<CityFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: defaultValues?.name || "",
      postal_code: defaultValues?.postal_code || "",
      state_id: defaultValues?.state_id || "",
      is_active: defaultValues?.is_active ?? true,
      ...defaultValues,
    },
  });

  const handleSubmit = (data: CityFormValues) => {
    showConfirmDialog(
      defaultValues?.name
        ? "¿Estás seguro de actualizar esta ciudad?"
        : "¿Estás seguro de crear esta ciudad?",
      () => onSubmit(data)
    );
  };

  const { data: countriesResponse } = useCountries({
    page: 1,
    size: 100,
    isActive: true,
  });
  const countries = countriesResponse?.items || [];

  const { data: statesResponse } = useStates({
    page: 1,
    size: 100,
    countryId: selectedCountryId || undefined,
    isActive: true,
  });
  const states = statesResponse?.items || [];

  // Reset logic removed in favor of key-based re-initialization

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <div className="grid grid-cols-12 gap-4 items-end">
          {/* Row 1: Country and Province */}
          <div className="col-span-12 md:col-span-6">
            <FormItem>
              <FormLabel>País</FormLabel>
              <Select
                value={selectedCountryId}
                onValueChange={(val) => {
                  setSelectedCountryId(val);
                  form.setValue("state_id", ""); // Reset state when country changes
                }}
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
            </FormItem>
          </div>

          <div className="col-span-12 md:col-span-6">
            <FormField
              control={form.control}
              name="state_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Provincia</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                    disabled={!selectedCountryId}
                  >
                    <FormControl>
                      <SelectTrigger className="h-10 w-full">
                        <SelectValue
                          placeholder={
                            selectedCountryId
                              ? "Selecciona una provincia"
                              : "Selecciona un país primero"
                          }
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {states.map((state: { id: string; name: string }) => (
                        <SelectItem key={state.id} value={state.id}>
                          {state.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* Row 2: Name, Postal Code, Active */}
          <div className="col-span-12 md:col-span-6">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre</FormLabel>
                  <FormControl>
                    <Input
                      className="h-10"
                      placeholder="Ingrese el nombre de la ciudad"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="col-span-6 md:col-span-3">
            <FormField
              control={form.control}
              name="postal_code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Código Postal</FormLabel>
                  <FormControl>
                    <Input
                      className="h-10"
                      placeholder="Código postal"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="col-span-12 md:col-span-3">
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
