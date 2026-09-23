/* eslint-disable @typescript-eslint/no-explicit-any */
import { getIdentificationTypesAction } from "@/admin/actions/identification.actions";
import {
  checkEmailAvailabilityAction,
  checkIdentificationAvailabilityAction,
  checkUsernameAvailabilityAction,
} from "@/admin/actions/user.actions";
import { useAuthStore } from "@/auth/store/auth.store";
import { SmartDatePicker } from "@/components/custom/SmartDatePicker";
import { SearchableSelect } from "@/components/custom/SearchableSelect";
import { SmartPhoneInput } from "@/components/custom/SmartPhoneInput";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { showConfirmDialog } from "@/store/confirm.store";
import { isValidIdentification } from "@/utils/validators";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Separator } from "@/components/ui/separator";
import { FormPageLayout } from "@/components/custom/FormPageLayout";
import {
  FULL_PAGE_FORM_ACTION_BUTTON_CLASS,
  FULL_PAGE_FORM_ACTIONS_CLASS,
  FULL_PAGE_FORM_BACK_LABEL,
  FULL_PAGE_FORM_SAVE_LABEL,
} from "@/components/custom/fullPageFormActions";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { AddressMapDialog } from "@/components/custom/AddressMapDialog";
import { ProfileRoleField } from "@/app/components/profile/ProfileRoleField";
import { profileSchema, type ProfileFormValues } from "./profile.schema";

const ProfileFormFields = () => {
  const navigate = useNavigate();
  const { user, updateProfile, updateAccount, checkAuthStatus } =
    useAuthStore();
  const isAdmin = useAuthStore((state) => state.isAdmin());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAddressDialogOpen, setIsAddressDialogOpen] = useState(false);
  const { data: identificationTypesData } = useQuery({
    queryKey: ["identificationTypes"],
    queryFn: () => getIdentificationTypesAction({ size: 100, isActive: true }),
  });
  const identificationTypes = identificationTypesData?.items ?? [];

  // Force refresh user data when component mounts
  const { isLoading } = useQuery({
    queryKey: ["profile-user"],
    queryFn: checkAuthStatus,
    staleTime: 0, // Always fetch fresh data
  });

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    values: {
      email: user?.email || "",
      username: user?.username || "",
      firstName: user?.firstName || (user as any)?.first_name || "",
      lastName: user?.lastName || (user as any)?.last_name || "",
      identificationTypeId:
        user?.identificationTypeId ||
        (user as any)?.identification_type_id ||
        "",
      identificationNumber:
        user?.identificationNumber ||
        (user as any)?.identification_number ||
        "",
      birthDate: user?.birthDate || (user as any)?.birth_date || "",
      phone: user?.phone || "",
      cityId: user?.cityId || (user as any)?.city_id || "",
      address: user?.address || "",
    },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const checkEmail = async () => {
    const email = form.getValues("email");
    if (email === user?.email) {
      form.clearErrors("email");
      return;
    }
    if (email && !form.getFieldState("email").invalid) {
      const isAvailable = await checkEmailAvailabilityAction(email);
      if (!isAvailable) {
        form.setError("email", {
          type: "manual",
          message: "Este correo electrónico ya está en uso",
        });
      } else {
        form.clearErrors("email");
      }
    }
  };

  const checkUsername = async () => {
    const username = form.getValues("username");
    if (username === user?.username) {
      form.clearErrors("username");
      return;
    }
    if (username && !form.getFieldState("username").invalid) {
      const isAvailable = await checkUsernameAvailabilityAction(username);
      if (!isAvailable) {
        form.setError("username", {
          type: "manual",
          message: "Este usuario ya está en uso",
        });
      } else {
        form.clearErrors("username");
      }
    }
  };

  const checkDni = async () => {
    const dni = form.getValues("identificationNumber");
    if (dni === user?.identificationNumber) {
      form.clearErrors("identificationNumber");
      return;
    }
    if (dni && !form.getFieldState("identificationNumber").invalid) {
      if (!isValidIdentification(dni)) {
        form.setError("identificationNumber", {
          type: "manual",
          message: "Solo números permitidos",
        });
        return;
      }

      const isAvailable = await checkIdentificationAvailabilityAction(dni);
      if (!isAvailable) {
        form.setError("identificationNumber", {
          type: "manual",
          message: "Número de documento ya registrado",
        });
      } else {
        form.clearErrors("identificationNumber");
      }
    }
  };

  const onSubmit = async (values: ProfileFormValues) => {
    showConfirmDialog("¿Guardar cambios en el perfil?", async () => {
      setIsSubmitting(true);
      try {
        const profileSuccess = await updateProfile({
          firstName: values.firstName,
          lastName: values.lastName,
          identificationTypeId: values.identificationTypeId || undefined,
          identificationNumber: values.identificationNumber,
          birthDate: values.birthDate || undefined,
          phone: values.phone,
          cityId: values.cityId || undefined,
          address: values.address,
        });

        let accountSuccess = true;
        if (
          user?.email !== values.email ||
          user?.username !== values.username
        ) {
          const result = await updateAccount(values.email, values.username);
          if (!result.success) {
            accountSuccess = false;
            toast.error(result.message);
            const msg = result.message.toLowerCase();
            if (msg.includes("email")) {
              form.setError("email", { message: result.message });
            } else if (msg.includes("username")) {
              form.setError("username", { message: result.message });
            }
          }
        }

        if (profileSuccess && accountSuccess) {
          toast.success("Perfil actualizado");
        }
      } catch (error) {
        toast.error("Error inesperado");
        console.error(error);
      } finally {
        setIsSubmitting(false);
      }
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <div className="space-y-6">
          {/* Main info columns */}
          <div className="grid grid-cols-1 gap-4 auto-rows-min min-w-0">
            {/* Row 1: Nombre, Apellido, Estado */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_1fr_0.45fr]">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>Nombre</FormLabel>
                    <FormControl>
                      <Input placeholder="Nombre" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>Apellido</FormLabel>
                    <FormControl>
                      <Input placeholder="Apellido" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="hidden min-w-0 flex-col space-y-2 md:flex">
                <span className="text-sm font-medium leading-none">Estado</span>
                <div className="h-10 flex items-center">
                  <Badge
                    variant={user?.isActive ? "default" : "secondary"}
                    className={`text-[10px] font-bold uppercase border-none shadow-none ${user?.isActive ? "bg-green-100 text-green-700 hover:bg-green-100" : "bg-red-100 text-red-700 hover:bg-red-100"}`}
                  >
                    {user?.isActive ? "Activo" : "Inactivo"}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Mobile only: Estado + Rol side by side */}
            <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-4 md:hidden">
              <div className="flex min-w-0 flex-col space-y-2">
                <span className="text-sm font-medium leading-none">Estado</span>
                <div className="h-10 flex items-center">
                  <Badge
                    variant={user?.isActive ? "default" : "secondary"}
                    className={`text-[10px] font-bold uppercase border-none shadow-none ${user?.isActive ? "bg-green-100 text-green-700 hover:bg-green-100" : "bg-red-100 text-red-700 hover:bg-red-100"}`}
                  >
                    {user?.isActive ? "Activo" : "Inactivo"}
                  </Badge>
                </div>
              </div>
              <ProfileRoleField
                isAdmin={Boolean(user?.isAdmin)}
                showPermissions={isAdmin}
                permissions={user?.permissions}
              />
            </div>

            {/* Row 2: Email, Usuario, Rol */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(12rem,0.65fr)]">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>Correo electrónico</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        className="min-w-0"
                        {...field}
                        onBlur={() => {
                          field.onBlur();
                          checkEmail();
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>Usuario</FormLabel>
                    <FormControl>
                      <Input
                        className="min-w-0"
                        {...field}
                        onBlur={() => {
                          field.onBlur();
                          checkUsername();
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="hidden min-w-0 md:block">
                <ProfileRoleField
                  isAdmin={Boolean(user?.isAdmin)}
                  showPermissions={isAdmin}
                  permissions={user?.permissions}
                />
              </div>
            </div>

            {/* Row 3: Documento */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="identificationTypeId"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>Tipo de documento</FormLabel>
                    <FormControl>
                      <SearchableSelect
                        options={identificationTypes.map((type: { id: string; name: string }) => ({
                          label: type.name,
                          value: type.id,
                        }))}
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="Seleccione tipo"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="identificationNumber"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>
                      <span className="hidden md:inline min-[1281px]:hidden">
                        Nro. Doc.
                      </span>
                      <span className="md:hidden min-[1281px]:inline">
                        Número de Documento
                      </span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Ingrese el número de documento"
                        className="min-w-0"
                        {...field}
                        onBlur={() => {
                          field.onBlur();
                          checkDni();
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Row 4: Fecha de nacimiento y teléfono */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[0.75fr_1.25fr]">
              <FormField
                control={form.control}
                name="birthDate"
                render={({ field }) => (
                  <FormItem className="flex min-w-0 flex-col">
                    <FormLabel>
                      <span className="hidden md:inline lg:hidden">
                        Fecha Nac.
                      </span>
                      <span className="md:hidden lg:inline">
                        Fecha de Nacimiento
                      </span>
                    </FormLabel>
                    <FormControl>
                      <SmartDatePicker
                        value={
                          field.value && field.value !== ""
                            ? new Date(
                                field.value.includes("T")
                                  ? field.value
                                  : `${field.value}T12:00:00`,
                              )
                            : undefined
                        }
                        onChange={(date) =>
                          field.onChange(date ? format(date, "yyyy-MM-dd") : "")
                        }
                        disabled={(date) =>
                          date > new Date() || date < new Date("1900-01-01")
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem className="flex min-w-0 flex-col">
                    <FormLabel>Teléfono</FormLabel>
                    <FormControl>
                      <SmartPhoneInput
                        value={field.value || ""}
                        onChange={field.onChange}
                        countryButtonClassName="w-[130px] md:w-[140px]"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Row 5: Dirección */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[0.55fr_1.45fr]">
              <FormItem className="flex min-w-0 flex-col">
                <FormLabel className="whitespace-nowrap">
                  Ingresar dirección
                </FormLabel>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => setIsAddressDialogOpen(true)}
                >
                  Abrir mapa
                </Button>
              </FormItem>

              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>Dirección</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Dirección"
                        {...field}
                        readOnly
                        disabled
                        className="w-full min-w-0 bg-muted text-muted-foreground"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        </div>

        <Separator />

        <div className={FULL_PAGE_FORM_ACTIONS_CLASS}>
          <Button
            type="button"
            variant="outline"
            className={FULL_PAGE_FORM_ACTION_BUTTON_CLASS}
            onClick={() => navigate(-1)}
          >
            {FULL_PAGE_FORM_BACK_LABEL}
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting}
            className={FULL_PAGE_FORM_ACTION_BUTTON_CLASS}
          >
            {isSubmitting ? (
              <Loader2
                aria-hidden="true"
                data-icon="inline-start"
                className="animate-spin"
              />
            ) : null}
            {FULL_PAGE_FORM_SAVE_LABEL}
          </Button>
        </div>
      </form>

      <AddressMapDialog
        open={isAddressDialogOpen}
        onOpenChange={setIsAddressDialogOpen}
        initialAddress={form.getValues("address") || ""}
        initialCityId={form.getValues("cityId") || ""}
        onConfirm={({ address, cityId }) => {
          form.setValue("address", address, { shouldValidate: true });
          form.setValue("cityId", cityId, { shouldValidate: true });
        }}
      />
    </Form>
  );
};

export const ProfilePage = () => {
  const { user } = useAuthStore();
  return (
    <FormPageLayout
      key={user?.id}
      title="Mi Perfil"
      subtitle="Gestiona tu información personal"
      hideBackButton
    >
      <ProfileFormFields />
    </FormPageLayout>
  );
};
