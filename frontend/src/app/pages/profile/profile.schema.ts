import * as z from "zod";

export const profileSchema = z.object({
  email: z.string().email("Email inválido"),
  username: z.string().min(3, "El usuario debe tener al menos 3 caracteres"),
  firstName: z.string().min(1, "El nombre es requerido"),
  lastName: z.string().min(1, "El apellido es requerido"),
  identificationTypeId: z.string().min(1, "El tipo de documento es requerido"),
  identificationNumber: z
    .string()
    .min(1, "El número de documento es requerido"),
  birthDate: z.string().optional(),
  phone: z.string().optional(),
  cityId: z.string().optional(),
  address: z.string().optional(),
});

export type ProfileFormValues = z.infer<typeof profileSchema>;
