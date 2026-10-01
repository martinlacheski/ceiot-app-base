import { BackButton } from "@/components/custom/BackButton";
import type { PropsWithChildren, ReactNode } from "react";

interface Props extends PropsWithChildren {
  title: string;
  subtitle: string;
  backUrl?: string;
  actions?: ReactNode;
  /** Width from which `actions` sit beside the title. Below it they stack full width under the
   * title. "sm" (default) keeps every existing page as it was; "lg" suits wide action groups
   * next to a long subtitle. */
  actionsBreakpoint?: "sm" | "lg";
}

const ROW_CLASSES = {
  sm: "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
  lg: "flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between",
} as const;

export const PageHeader = ({
  title,
  subtitle,
  backUrl,
  actions,
  actionsBreakpoint = "sm",
  children,
}: Props) => {
  return (
    <div className="space-y-2 h-full flex flex-col">
      <div data-slot="page-header-row" className={ROW_CLASSES[actionsBreakpoint]}>
        <div className="flex min-w-0 items-start gap-3 sm:items-center sm:gap-4">
          {backUrl && <BackButton to={backUrl} />}
          <div className="min-w-0 space-y-1">
            <h1 className="text-xl lg:text-2xl xl:text-3xl font-bold text-balance">{title}</h1>
            <p className="text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        {actions && (
          <div className={actionsBreakpoint === "lg" ? "w-full lg:w-auto" : undefined}>
            {actions}
          </div>
        )}
      </div>
      {children}
    </div>
  );
};
