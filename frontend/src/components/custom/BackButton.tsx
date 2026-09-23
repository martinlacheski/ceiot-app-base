import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BackButtonProps {
  to?: string;
  onClick?: () => void;
  label?: string;
  className?: string;
}

/** Shared icon-only, 44px back control for page headers. */
export function BackButton({ to, onClick, label = "Volver", className }: BackButtonProps) {
  const classes = cn(
    "size-11 shrink-0 border-border bg-background hover:bg-accent dark:border-border dark:bg-background dark:hover:bg-accent",
    className,
  );

  if (to) {
    return (
      <Button variant="outline" size="icon" className={classes} asChild>
        <Link to={to} aria-label={label}>
          <ArrowLeft className="h-4 w-4" />
        </Link>
      </Button>
    );
  }

  return (
    <Button type="button" variant="outline" size="icon" className={classes} aria-label={label} onClick={onClick}>
      <ArrowLeft className="h-4 w-4" />
    </Button>
  );
}
