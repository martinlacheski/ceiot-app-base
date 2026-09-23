import { BackButton } from "@/components/custom/BackButton";
import type { PropsWithChildren, ReactNode } from "react";

interface Props extends PropsWithChildren {
  title: string;
  subtitle: string;
  backUrl?: string;
  actions?: ReactNode;
}

export const PageHeader = ({
  title,
  subtitle,
  backUrl,
  actions,
  children,
}: Props) => {
  return (
    <div className="space-y-2 h-full flex flex-col">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3 sm:items-center sm:gap-4">
          {backUrl && <BackButton to={backUrl} />}
          <div className="min-w-0 space-y-1">
            <h1 className="text-xl lg:text-2xl xl:text-3xl font-bold text-balance">{title}</h1>
            <p className="text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        {actions && <div>{actions}</div>}
      </div>
      {children}
    </div>
  );
};
