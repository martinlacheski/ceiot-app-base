import type { User } from "@/interfaces/user.interface";

type ExportUser = Pick<User, "fullName" | "username" | "email"> | null | undefined;

export function getExportGeneratedBy(user: ExportUser): string {
  const fullName = user?.fullName?.trim();

  return fullName || user?.username || user?.email || "Usuario";
}
