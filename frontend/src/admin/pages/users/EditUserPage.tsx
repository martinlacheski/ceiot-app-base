import {
  UserForm,
  type UserFormValues,
} from "@/admin/components/users/UserForm";
import { useUpdateUser, useUser } from "@/admin/hooks/useUsers";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import { showConfirmDialog } from "@/store/confirm.store";

export default function EditUserPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const userId = id || "";

  const { data: user, isLoading, error } = useUser(userId);
  const { mutateAsync: updateUser, isPending } = useUpdateUser();

  if (!userId) {
    return <div>ID de usuario inválido</div>;
  }

  const handleSubmit = async (values: UserFormValues) => {
    showConfirmDialog(
      "¿Estás seguro de que deseas guardar los cambios?",
      async () => {
        try {
          await updateUser({ id: userId, user: values });
          toast.success("Usuario actualizado exitosamente");
          navigate("/admin/users");
        } catch (error) {
          toast.error("Error al actualizar usuario, error: " + error);
        }
      }
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <Skeleton className="h-[400px] w-full max-w-2xl rounded-lg" />
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4 text-center">
        <h2 className="text-xl font-semibold">Usuario no encontrado</h2>
        <p className="text-muted-foreground">
          No se pudo cargar la información del usuario solicitado.
        </p>
        <Button asChild>
          <Link to="/admin/users">Volver al listado</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full min-w-0 max-w-8xl flex-col gap-4 overflow-x-clip">
      <div className="flex min-w-0 items-start gap-3 sm:gap-4">
        <Button variant="outline" size="icon" className="size-11 shrink-0" asChild>
          <Link to="/admin/users">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Editar Usuario</h1>
          <p className="text-muted-foreground">
            Modifica los datos de {user.username}.
          </p>
        </div>
      </div>

      <div className="w-full min-w-0 rounded-lg border bg-card p-4 sm:p-6">
        <UserForm
          mode="edit"
          defaultValues={user}
          onSubmit={handleSubmit}
          isSubmitting={isPending}
          submitLabel="Guardar Cambios"
          onCancel={() => navigate("/admin/users")}
          cancelLabel="Volver"
        />
      </div>
    </div>
  );
}
