import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/utils/utils";
import { Check, ChevronsUpDown, X } from "lucide-react";
import * as React from "react";

export interface Option {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  options: Option[];
  value?: string;
  onChange: (value: string | undefined) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  className?: string;
  disabled?: boolean;
  /**
   * Called with the text typed in the search box (and with "" when the list is
   * closed), so the parent can search on the server.
   */
  onSearchChange?: (term: string) => void;
  /** Set to false when `options` already come filtered (server-side search). */
  shouldFilter?: boolean;
  /** Shown instead of `emptyMessage` while the options are being fetched. */
  isLoading?: boolean;
  /** Label of `value` when it is not (or no longer) among `options`. */
  selectedLabel?: string;
  /** Set to false to hide the inline clear (X) button, e.g. when a shared "clear all filters" action already covers it. */
  showClear?: boolean;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Seleccionar...",
  searchPlaceholder = "Buscar...",
  emptyMessage = "No se encontraron resultados.",
  className,
  disabled,
  onSearchChange,
  shouldFilter = true,
  isLoading = false,
  selectedLabel,
  showClear = true,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    // The search box is unmounted with the list: reset the term it reported.
    if (!next) onSearchChange?.("");
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full min-w-0 justify-between", className)}
          disabled={disabled}
        >
          <span className="min-w-0 truncate text-left">
            {value
              ? (options.find((option) => option.value === value)?.label ??
                selectedLabel)
              : placeholder}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            {value && !disabled && showClear && (
              <div
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(undefined);
                }}
                className="hover:bg-muted p-0.5 rounded-full"
              >
                <X className="h-3 w-3 opacity-50 hover:opacity-100" />
              </div>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0 z-[9999]"
        align="start"
      >
        <Command shouldFilter={shouldFilter}>
          <CommandInput
            placeholder={searchPlaceholder}
            onValueChange={onSearchChange}
          />
          <CommandList>
            <CommandEmpty>{isLoading ? "Buscando..." : emptyMessage}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  onSelect={() => {
                    onChange(option.value === value ? undefined : option.value);
                    handleOpenChange(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === option.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
