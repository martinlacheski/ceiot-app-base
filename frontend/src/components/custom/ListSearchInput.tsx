import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const LIST_SEARCH_PLACEHOLDER = "Buscar en todos los campos...";

interface ListSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}

/** Standard search box of every list screen, with a clear button while it has text. */
export function ListSearchInput({
  value,
  onChange,
  onClear,
  placeholder = LIST_SEARCH_PLACEHOLDER,
  ariaLabel,
  className,
}: ListSearchInputProps) {
  return (
    <div className={cn("relative w-full min-w-0", className)} data-testid="list-search-input">
      <Input
        placeholder={placeholder}
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="pr-11"
        data-list-toolbar-search-control
      />
      {value ? (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-0 top-1/2 size-11 -translate-y-1/2"
          onClick={onClear}
          aria-label="Limpiar búsqueda"
        >
          <X />
        </Button>
      ) : null}
    </div>
  );
}
