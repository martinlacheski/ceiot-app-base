import type { SessionUser, User } from "@/interfaces/user.interface";

export const getUserFullName = (
  user: Pick<User, "firstName" | "lastName">,
): string => [user.firstName, user.lastName].filter(Boolean).join(" ");

export const withFullName = (user: User): SessionUser => ({
  ...user,
  fullName: getUserFullName(user),
});
