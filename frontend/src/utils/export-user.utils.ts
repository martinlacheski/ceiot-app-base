import type { SessionUser } from "@/interfaces/user.interface";

type ExportUser = Pick<SessionUser, "fullName" | "username" | "email"> | null | undefined;

export function getExportGeneratedBy(user: ExportUser): string {
  const fullName = user?.fullName?.trim();

  return fullName || user?.username || user?.email || "Usuario";
}
