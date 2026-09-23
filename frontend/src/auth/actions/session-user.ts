import type { User } from "@/interfaces/user.interface";

export const withFullName = (user: User): User => ({
  ...user,
  fullName: [user.firstName, user.lastName].filter(Boolean).join(" "),
});
