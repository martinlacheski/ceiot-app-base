import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Centered header for columns that cannot be sorted (e.g. "Acciones"). */
export function CenteredHeader({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("text-center", className)}>{children}</div>;
}
