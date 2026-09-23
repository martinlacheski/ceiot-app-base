/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  UserForm,
  type UserFormValues,
} from "@/admin/components/users/UserForm";
import { useCreateUser, useUpdateUser } from "@/admin/hooks/useUsers";
import { Button } from "@/components/ui/button";
import { showConfirmDialog } from "@/store/confirm.store";
import { ArrowLeft } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

export default function CreateUserPage() {
  const navigate = useNavigate();
  const { mutateAsync: createUser, isPending } = useCreateUser();
  const { mutateAsync: updateUser } = useUpdateUser();

  const handleSubmit = async (values: UserFormValues) => {
    showConfirmDialog(
      "¿Estás seguro de que deseas crear este usuario?",
      async () => {
        try {
          await createUser(values as any);
          toast.success("Usuario creado exitosamente");
          navigate("/admin/users");
        } catch (error: any) {
          if (
            error.response?.status === 409 &&
            error.response?.data?.detail?.code === "INACTIVE_DUPLICATE"
          ) {
            const { id } = error.response.data.detail;
            showConfirmDialog(
              "Ya existe un usuario inactivo con estos datos. ¿Deseas habilitarlo?",
              async () => {
                try {
                  await updateUser({ id, user: { isActive: true } });
                  toast.success("Usuario habilitado exitosamente");
                  navigate("/admin/users");
                } catch {
                  toast.error("Error al habilitar usuario");
                }
              }
            );
            return;
          }
          toast.error("Error al crear usuario, error: " + error);
        }
      }
    );
  };

  return (
    <div className="flex h-full w-full min-w-0 max-w-8xl flex-col gap-4 overflow-x-clip">
      <div className="flex min-w-0 items-start gap-3 sm:gap-4">
        <Button variant="outline" size="icon" className="size-11 shrink-0" asChild>
          <Link to="/admin/users">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Crear Usuario</h1>
          <p className="text-muted-foreground">
            Ingresa los datos para registrar un nuevo usuario en el sistema.
          </p>
        </div>
      </div>

      <div className="w-full min-w-0 rounded-lg border bg-card p-4 sm:p-6">
        <UserForm
          mode="create"
          onSubmit={handleSubmit}
          isSubmitting={isPending}
          submitLabel="Crear Usuario"
          onCancel={() => navigate("/admin/users")}
          cancelLabel="Volver"
        />
      </div>
    </div>
  );
}
