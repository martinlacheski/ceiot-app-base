import { PermissionsDialogButton } from "@/app/components/profile/PermissionsDialogButton";
import { Badge } from "@/components/ui/badge";

interface ProfileRoleFieldProps {
  isAdmin: boolean;
  showPermissions: boolean;
  permissions?: string[];
}

export function ProfileRoleField({
  isAdmin,
  showPermissions,
  permissions,
}: ProfileRoleFieldProps) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="text-sm font-medium leading-none">Rol</span>
      <div
        data-testid="profile-role-row"
        className="flex min-h-11 min-w-0 flex-nowrap items-center gap-2 md:min-h-10"
      >
        <Badge
          variant="secondary"
          className="border-none bg-slate-200 text-[10px] font-bold uppercase text-slate-700 shadow-none hover:bg-slate-200"
        >
          {isAdmin ? "Admin" : "Usuario"}
        </Badge>
        {showPermissions && permissions && permissions.length > 0 ? (
          <PermissionsDialogButton
            permissions={permissions}
            className="h-11 min-w-0 shrink px-2 text-xs md:h-9 md:px-3 md:text-sm"
          />
        ) : null}
      </div>
    </div>
  );
}
