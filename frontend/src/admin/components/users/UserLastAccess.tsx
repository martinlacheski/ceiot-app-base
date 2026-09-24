import type { User } from "@/interfaces/user.interface";
import { formatDateTime, formatRelativeTime } from "@/utils/date.utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type UserActivity = Pick<
  User,
  "createdAt" | "updatedAt" | "lastLoginAt" | "lastSeenAt"
>;

/** Actividad más reciente conocida del usuario: última actividad, si no último login. */
function getLastAccess(user: UserActivity): string | null {
  return user.lastSeenAt || user.lastLoginAt || null;
}

function getLastAccessLabel(user: UserActivity): string {
  const lastAccess = getLastAccess(user);
  return lastAccess ? formatRelativeTime(lastAccess) : "Nunca";
}

function getActivityDates(user: UserActivity) {
  const show = (value?: string | null) =>
    value ? formatDateTime(value) : "—";
  return [
    { label: "Creado", value: show(user.createdAt) },
    { label: "Actualizado", value: show(user.updatedAt) },
    { label: "Último login", value: show(user.lastLoginAt) },
    { label: "Última actividad", value: show(user.lastSeenAt) },
  ];
}

/** Última actividad relativa con un tooltip con las fechas exactas (escritorio). */
export function UserLastAccessCell({ user }: { user: UserActivity }) {
  const never = !getLastAccess(user);
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className={
              never
                ? "cursor-default text-muted-foreground"
                : "cursor-default underline decoration-dotted underline-offset-4"
            }
          >
            {getLastAccessLabel(user)}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <ul className="flex flex-col gap-0.5 text-left">
            {getActivityDates(user).map(({ label, value }) => (
              <li key={label}>{`${label}: ${value}`}</li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Versión compacta en texto para dispositivos táctiles, donde no hay tooltip. */
export function UserLastAccessLines({ user }: { user: UserActivity }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 text-sm text-muted-foreground">
      <span>{`Último acceso: ${getLastAccessLabel(user)}`}</span>
      {getActivityDates(user).map(({ label, value }) => (
        <span key={label} className="text-xs">{`${label}: ${value}`}</span>
      ))}
    </div>
  );
}

/** Etiqueta de última actividad o "Nunca" lista para exportar. */
export function getUserLastAccessExportValue(user: UserActivity): string {
  const lastAccess = getLastAccess(user);
  return lastAccess ? formatDateTime(lastAccess) : "Nunca";
}
