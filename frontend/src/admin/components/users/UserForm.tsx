/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  checkEmailAvailabilityAction,
  checkIdentificationAvailabilityAction,
  checkUsernameAvailabilityAction,
  getPermissionsAction,
} from "@/admin/actions/user.actions";
import { PERMISSIONS as STATIC_PERMISSIONS } from "@/admin/constants/permissions"; // Fallback
import { SmartDatePicker } from "@/components/custom/SmartDatePicker";
import { SmartPhoneInput } from "@/components/custom/SmartPhoneInput";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { cn } from "@/utils/utils";
import {
  getPasswordRequirements,
  isValidIdentification,
} from "@/utils/validators";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { Check, Loader2, X as XIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { AddressMapDialog } from "@/components/custom/AddressMapDialog";
import { SearchableSelect } from "@/components/custom/SearchableSelect";
import { getIdentificationTypesAction } from "@/admin/actions/identification.actions";
import { useQuery } from "@tanstack/react-query";
import {
  FULL_PAGE_FORM_ACTION_BUTTON_CLASS,
  FULL_PAGE_FORM_ACTIONS_CLASS,
  FULL_PAGE_FORM_BACK_LABEL,
  getFullPageFormPrimaryLabel,
} from "@/components/custom/fullPageFormActions";

const CREATE_USER_LABEL = "Crear Usuario";

// Define mandatory permissions that cannot be unchecked
const MANDATORY_PERMISSIONS = [
  "user:me",
  "user:password",
  "location:read",
  "identification_type:read",
  "environment:read",
  "environment:create",
  "environment:update",
  "environment:delete",
  "invitation:read",
  "invitation:create",
  "invitation:delete",
  "device:read",
  "device:pair",
  "device:update",
];

const getUserSchema = (mode: "create" | "edit") =>
  z
    .object({
      email: z.string().email("Correo electrónico inválido"),
      username: z
        .string()
        .min(3, "El usuario debe tener al menos 3 caracteres"),
      firstName: z.string().min(1, "El nombre es requerido"),
      lastName: z.string().min(1, "El apellido es requerido"),
      identificationNumber: z.string().min(1, "El DNI es requerido"),
      birthDate: z.string().optional(),
      phone: z.string().optional(),

      identificationTypeId: z.string().optional(),
      cityId: z.string().optional(),
      address: z.string().optional(),

      isActive: z.boolean().default(true),
      isAdmin: z.boolean().default(false),
      permissions: z.array(z.string()).default([]),
      password: z.string().optional(),
      confirmPassword: z.string().optional(),
    })
    .refine(
      (data) => {
        if (mode === "create") {
          return !!data.password;
        }
        return true;
      },
      {
        message: "La contraseña es requerida",
        path: ["password"],
      },
    )
    .refine(
      (data) => {
        if (mode === "create") {
          const complexityRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
          return complexityRegex.test(data.password || "");
        }
        return true;
      },
      {
        message: "La contraseña es demasiado débil",
        path: ["password"],
      },
    )
    .refine(
      (data) => {
        if (mode === "create") {
          return !!data.confirmPassword;
        }
        return true;
      },
      {
        message: "La confirmación de contraseña es requerida",
        path: ["confirmPassword"],
      },
    )
    .refine(
      (data) => {
        if (data.password || data.confirmPassword) {
          return data.password === data.confirmPassword;
        }
        return true;
      },
      {
        message: "Las contraseñas no coinciden",
        path: ["confirmPassword"],
      },
    );

export type UserFormValues = z.infer<ReturnType<typeof getUserSchema>>;

interface UserFormProps {
  mode: "create" | "edit";
  defaultValues?: Partial<UserFormValues> & { city_id?: string };
  onSubmit: (values: UserFormValues) => Promise<void>;
  isSubmitting?: boolean;
  submitLabel?: string;
  onCancel?: () => void;
  cancelLabel?: string;
}

export function UserForm({
  mode,
  defaultValues,
  onSubmit,
  isSubmitting = false,
  submitLabel,
  onCancel,
  cancelLabel = FULL_PAGE_FORM_BACK_LABEL,
}: UserFormProps) {
  const primaryLabel =
    submitLabel ?? getFullPageFormPrimaryLabel(mode, CREATE_USER_LABEL);
  const [showPassword, setShowPassword] = useState(false);
  const [isAddressDialogOpen, setIsAddressDialogOpen] = useState(false);
  const normalizedDefaultValues = (defaultValues ||
    {}) as Partial<UserFormValues> & {
    city_id?: string;
    address?: string;
  };
  // Queries for types
  const { data: identificationTypesData } = useQuery({
    queryKey: ["identificationTypes"],
    queryFn: () => getIdentificationTypesAction({ size: 100, isActive: true }),
  });

  const identificationTypes = identificationTypesData?.items ?? [];

  const { data: permissionsData } = useQuery({
    queryKey: ["permissions"],
    queryFn: () => getPermissionsAction(),
  });

  // Normalize permissions to a list of groups
  const groups: any[] = useMemo(() => {
    if (permissionsData?.groups) {
      return permissionsData.groups;
    }
    return Object.values(STATIC_PERMISSIONS);
  }, [permissionsData]);

  const allPermissions = useMemo(() => {
    return groups.flatMap((group: any) => group.items.map((p: any) => p.value));
  }, [groups]);

  // Merge default values only once on init
  const form = useForm<UserFormValues>({
    resolver: zodResolver(getUserSchema(mode)) as any,
    defaultValues: {
      email: defaultValues?.email || "",
      username: defaultValues?.username || "",
      firstName: defaultValues?.firstName || "",
      lastName: defaultValues?.lastName || "",
      identificationNumber: defaultValues?.identificationNumber || "",
      birthDate: defaultValues?.birthDate || "",
      phone: defaultValues?.phone || "",

      identificationTypeId: defaultValues?.identificationTypeId || "",
      cityId:
        normalizedDefaultValues.cityId || normalizedDefaultValues.city_id || "",
      address: normalizedDefaultValues.address || "",

      isActive: defaultValues?.isActive ?? true,
      isAdmin: defaultValues?.isAdmin ?? false,
      permissions: defaultValues?.permissions || [
        "user:me",
        "user:password",
        "location:read",
        "identification_type:read",
        "environment:read",
        "environment:create",
        "environment:update",
        "environment:delete",
        "invitation:read",
        "invitation:create",
        "invitation:delete",
        "device:read",
        "device:pair",
        "device:update",
      ],
      password: "",
      confirmPassword: "",
    },
  });

  // Store permissions before admin toggle to restore them if untoggled
  const previousPermissionsRef = useRef<string[]>(
    defaultValues?.permissions || ["user:me", "user:password"],
  );

  // Watch permissions to update UI dynamically
  // eslint-disable-next-line react-hooks/incompatible-library
  const currentPermissions = form.watch("permissions");

  // Watch password for requirements
  const password = form.watch("password") || "";
  const confirmPassword = form.watch("confirmPassword") || "";
  const {
    hasUppercase,
    hasLowercase,
    hasNumber,
    hasLength: has8Characters,
  } = getPasswordRequirements(password);

  const handleAdminToggle = (checked: boolean) => {
    form.setValue("isAdmin", checked);
    if (checked) {
      // Save current permissions before overwriting
      previousPermissionsRef.current = form.getValues("permissions");
      // Select all permissions
      form.setValue("permissions", allPermissions);
    } else {
      // Restore previous permissions
      form.setValue("permissions", previousPermissionsRef.current);
    }
  };

  const checkEmail = async () => {
    const email = form.getValues("email");
    if (email === defaultValues?.email) {
      form.clearErrors("email");
      return;
    }
    // Check if new or changed
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
    if (username === defaultValues?.username) {
      form.clearErrors("username");
      return;
    }
    // Check if new or changed
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
    if (dni === defaultValues?.identificationNumber) {
      form.clearErrors("identificationNumber");
      return;
    }
    // Check if new or changed
    if (dni && !form.getFieldState("identificationNumber").invalid) {
      // 1. Validate format first (like RegisterPage)
      if (!isValidIdentification(dni)) {
        form.setError("identificationNumber", {
          type: "manual",
          message: "El número de documento debe contener solo números",
        });
        return;
      }

      // 2. Validate availability
      const isAvailable = await checkIdentificationAvailabilityAction(dni);
      if (!isAvailable) {
        form.setError("identificationNumber", {
          type: "manual",
          message: "Este DNI ya está registrado",
        });
      } else {
        form.clearErrors("identificationNumber");
      }
    }
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit as any)}
        className="w-full min-w-0 space-y-4"
      >
        {/* Nombre y Apellido */}
        <div
          className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2"
          data-testid="name-fields"
        >
          <FormField
            control={form.control as any}
            name="firstName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nombre</FormLabel>
                <FormControl>
                  <Input placeholder="Ingrese los nombres" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control as any}
            name="lastName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Apellido</FormLabel>
                <FormControl>
                  <Input placeholder="Ingrese los apellidos" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Identificación y Tipo */}
        <div
          className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2"
          data-testid="identification-fields"
        >
          <FormField
            control={form.control as any}
            name="identificationTypeId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tipo de Identificación</FormLabel>
                <FormControl>
                  <SearchableSelect
                    options={identificationTypes.map((t: { id: string; name: string }) => ({
                      label: t.name,
                      value: t.id,
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
            control={form.control as any}
            name="identificationNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Número de Identificación</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Ingrese el número de documento"
                    {...field}
                    onChange={(e) => {
                      field.onChange(e);
                      if (form.getFieldState("identificationNumber").invalid) {
                        form.clearErrors("identificationNumber");
                      }
                    }}
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

        <div
          className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2"
          data-testid="address-fields"
        >
          <FormField
            control={form.control as any}
            name="address"
            render={({ field }) => (
              <FormItem className="min-w-0">
                <FormLabel>Dirección</FormLabel>
                <div
                  className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center"
                  data-testid="address-action"
                >
                  <FormControl>
                    <Input
                      placeholder="Dirección"
                      {...field}
                      readOnly
                      className="w-full min-w-0 bg-muted text-muted-foreground"
                    />
                  </FormControl>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-11 w-full shrink-0 sm:w-auto"
                    onClick={() => setIsAddressDialogOpen(true)}
                  >
                    Abrir mapa
                  </Button>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div
          className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2"
          data-testid="account-fields"
        >
          <FormField
            control={form.control as any}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Ingrese el correo electrónico"
                    type="email"
                    {...field}
                    onChange={(e) => {
                      field.onChange(e);
                      if (form.getFieldState("email").invalid) {
                        form.clearErrors("email");
                      }
                    }}
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
            control={form.control as any}
            name="username"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Usuario</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Ingrese el nombre de usuario"
                    {...field}
                    onChange={(e) => {
                      field.onChange(e);
                      if (form.getFieldState("username").invalid) {
                        form.clearErrors("username");
                      }
                    }}
                    onBlur={() => {
                      field.onBlur();
                      checkUsername();
                    }}
                    autoComplete="username"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Password Fields - Only in CREATE mode */}
        {mode === "create" && (
          <div className="flex flex-col gap-2">
            <div
              className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2"
              data-testid="password-fields"
            >
              <FormField
                control={form.control as any}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contraseña {mode === "create" && "*"}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Ingrese la contraseña"
                        type={showPassword ? "text" : "password"}
                        {...field}
                        autoComplete="new-password"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control as any}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Confirmar Contraseña {mode === "create" && "*"}
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Confirme la contraseña"
                        type={showPassword ? "text" : "password"}
                        {...field}
                        autoComplete="new-password"
                      />
                    </FormControl>
                    {confirmPassword && password !== confirmPassword && (
                      <span className="text-red-500 text-xs font-medium">
                        Las contraseñas no coinciden
                      </span>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Password Strength Indicator */}
            {(password || form.formState.isSubmitted) && (
              <div className="flex flex-col gap-1 text-sm text-destructive font-medium">
                <span
                  className={cn(
                    "flex items-center gap-1",
                    hasUppercase ? "text-green-600" : "text-muted-foreground",
                  )}
                >
                  {hasUppercase ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <XIcon className="h-3 w-3" />
                  )}{" "}
                  1 Mayúscula
                </span>
                <span
                  className={cn(
                    "flex items-center gap-1",
                    hasLowercase ? "text-green-600" : "text-muted-foreground",
                  )}
                >
                  {hasLowercase ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <XIcon className="h-3 w-3" />
                  )}{" "}
                  1 Minúscula
                </span>
                <span
                  className={cn(
                    "flex items-center gap-1",
                    hasNumber ? "text-green-600" : "text-muted-foreground",
                  )}
                >
                  {hasNumber ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <XIcon className="h-3 w-3" />
                  )}{" "}
                  1 Número
                </span>
                <span
                  className={cn(
                    "flex items-center gap-1",
                    has8Characters ? "text-green-600" : "text-muted-foreground",
                  )}
                >
                  {has8Characters ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <XIcon className="h-3 w-3" />
                  )}{" "}
                  8 Caracteres
                </span>
              </div>
            )}

            <div className="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? "Ocultar contraseñas" : "Mostrar contraseñas"}
              </Button>
            </div>
          </div>
        )}

        <div className="grid w-full min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
          {/* Teléfono */}
          <div className="min-w-0">
            <FormField
              control={form.control as any}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Teléfono</FormLabel>
                  <FormControl>
                    <SmartPhoneInput
                      placeholder="Ingrese el teléfono"
                      value={field.value || ""}
                      onChange={field.onChange}
                      className="w-full min-w-0"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          {/* Fecha de Nacimiento - Ocupa casi la mitad */}
          <div className="min-w-0">
            <FormField
              control={form.control as any}
              name="birthDate"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Fecha de Nacimiento</FormLabel>
                  <FormControl>
                    <SmartDatePicker
                      className="w-full min-w-0"
                      value={
                        field.value
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
          </div>
        </div>

        {/* Contenedor para los Switches con margen a la izquierda */}
        <div className="flex flex-row flex-wrap gap-8 pt-2">
          {/* Estado */}
          <FormField
            control={form.control as any}
            name="isActive"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>Estado</FormLabel>
                <div className="flex items-center space-x-2 h-10">
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <span className="text-sm font-medium">Activo</span>
                </div>
              </FormItem>
            )}
          />

          {/* ¿Es Admin? */}
          <FormField
            control={form.control as any}
            name="isAdmin"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>¿Es Admin?</FormLabel>
                <div className="flex items-center space-x-2 h-10">
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={handleAdminToggle}
                    />
                  </FormControl>
                  <span className="text-sm font-medium">Administrador</span>
                </div>
              </FormItem>
            )}
          />
        </div>

        <div className="space-y-4 rounded-lg border p-4">
          <h3 className="font-medium">Permisos</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {groups.map((group: any) => {
              const groupValues = group.items.map((i: any) => i.value);
              const isGroupComplete = groupValues.every((val: any) =>
                currentPermissions?.includes(val),
              );

              return (
                <div key={group.label} className="space-y-3">
                  <h4 className="text-sm font-medium text-primary">
                    {group.label}
                    <span
                      className="ml-2 text-xs text-muted-foreground cursor-pointer hover:underline select-none"
                      onClick={() => {
                        let newPermissions: string[];

                        if (isGroupComplete) {
                          // Deselect but keep mandatory ones
                          newPermissions = currentPermissions.filter(
                            (p) =>
                              !groupValues.includes(p) ||
                              MANDATORY_PERMISSIONS.includes(p),
                          );
                        } else {
                          // Select all
                          newPermissions = Array.from(
                            new Set([...currentPermissions, ...groupValues]),
                          );
                        }
                        form.setValue("permissions", newPermissions);
                      }}
                    >
                      {isGroupComplete
                        ? "Deseleccionar todos"
                        : "Seleccionar todos"}
                    </span>
                  </h4>
                  <div className="space-y-2">
                    {group.items.map((permission: any) => {
                      const isMandatory = MANDATORY_PERMISSIONS.includes(
                        permission.value,
                      );

                      return (
                        <FormField
                          key={permission.value}
                          control={form.control as any}
                          name="permissions"
                          render={({ field }) => {
                            return (
                              <FormItem
                                key={permission.value}
                                className="flex flex-row items-start space-x-3 space-y-0"
                              >
                                <FormControl>
                                  <Checkbox
                                    checked={field.value?.includes(
                                      permission.value,
                                    )}
                                    disabled={isMandatory}
                                    onCheckedChange={(checked) => {
                                      return checked
                                        ? field.onChange([
                                            ...field.value,
                                            permission.value,
                                          ])
                                        : field.onChange(
                                            field.value?.filter(
                                              (value: string) =>
                                                value !== permission.value,
                                            ),
                                          );
                                    }}
                                  />
                                </FormControl>
                                <FormLabel className="font-normal">
                                  {permission.label}
                                </FormLabel>
                              </FormItem>
                            );
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div
          className={FULL_PAGE_FORM_ACTIONS_CLASS}
          data-testid="form-actions"
        >
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={isSubmitting}
              className={FULL_PAGE_FORM_ACTION_BUTTON_CLASS}
            >
              {cancelLabel}
            </Button>
          )}
          <Button
            type="submit"
            disabled={isSubmitting}
            className={FULL_PAGE_FORM_ACTION_BUTTON_CLASS}
          >
            {isSubmitting && (
              <Loader2
                aria-hidden="true"
                data-icon="inline-start"
                className="animate-spin"
              />
            )}
            {primaryLabel}
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
}
