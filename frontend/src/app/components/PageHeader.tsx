import { Link } from "react-router";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
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
        <div className="space-y-1">
          {backUrl && (
            <Button
              variant="ghost"
              size="sm"
              className="mb-2 -ml-2 pl-2"
              asChild
            >
              <Link to={backUrl}>
                <ChevronLeft className="mr-1 h-4 w-4" />
                Volver
              </Link>
            </Button>
          )}
          <h1 className="text-xl lg:text-2xl xl:text-3xl font-bold text-balance">{title}</h1>
          <p className="text-muted-foreground">{subtitle}</p>
        </div>
        {actions && <div>{actions}</div>}
      </div>
      {children}
    </div>
  );
};
