import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router";
import type { ReactNode } from "react";

interface FormPageLayoutProps {
  title: string;
  subtitle: string;
  backUrl?: string; // Optional custom back URL
  onBack?: () => void; // Optional custom back handler
  hideBackButton?: boolean;
  children: ReactNode;
}

export function FormPageLayout({
  title,
  subtitle,
  backUrl,
  onBack,
  hideBackButton = false,
  children,
}: FormPageLayoutProps) {
  const navigate = useNavigate();

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else if (backUrl) {
      navigate(backUrl);
    } else {
      navigate(-1);
    }
  };

  return (
    <div className="flex h-full w-full min-w-0 max-w-full flex-col gap-4">
      <div className="flex min-w-0 items-start gap-3 sm:items-center sm:gap-4">
        {!hideBackButton && (
          <Button
            variant="outline"
            size="icon"
            onClick={handleBack}
            className="shrink-0"
            aria-label="Volver"
          >
            <ArrowLeft />
          </Button>
        )}
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight break-words lg:text-2xl xl:text-3xl">{title}</h2>
          <p className="text-muted-foreground">{subtitle}</p>
        </div>
      </div>

      <div className="w-full min-w-0 rounded-lg border bg-card p-4 sm:p-6">{children}</div>
    </div>
  );
}
