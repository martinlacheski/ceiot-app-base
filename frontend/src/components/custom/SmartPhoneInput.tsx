import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { COUNTRY_CODES, type CountryCode } from "@/constants/country-codes";
import { cn } from "@/utils/utils";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { useState } from "react";

interface SmartPhoneInputProps {
  value?: string;
  onChange: (value: string) => void;
  className?: string;
  countryButtonClassName?: string;
  placeholder?: string;
}

// Sort codes by length desc once to match longer codes first
const SORTED_CODES = [...COUNTRY_CODES].sort(
  (a, b) => b.dial_code.length - a.dial_code.length
);

export function SmartPhoneInput({
  value = "",
  onChange,
  className,
  countryButtonClassName,
  placeholder = "Número de teléfono",
}: SmartPhoneInputProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  let country: CountryCode = COUNTRY_CODES.find((c) => c.code === "AR")!;
  let localNumber = "";

  if (value) {
    const found = SORTED_CODES.find((c) => value.startsWith(c.dial_code));
    if (found) {
      country = found;
      localNumber = value.slice(found.dial_code.length).trim();
    } else {
      localNumber = value;
    }
  }

  const filteredCountries = searchQuery
    ? COUNTRY_CODES.filter(
        (c) =>
          c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.dial_code.includes(searchQuery) ||
          c.code.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : COUNTRY_CODES;

  const handleCountrySelect = (newCountry: CountryCode) => {
    // Preserve local number but switch code
    const newValue = `${newCountry.dial_code} ${localNumber}`;
    onChange(newValue);
    setOpen(false);
    setSearchQuery(""); // Reset search on close
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^0-9\s-]/g, "");
    // Always attach current country code
    const newValue = `${country.dial_code} ${val}`;
    onChange(newValue);
  };

  return (
    <div className={cn("flex w-full min-w-0 gap-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "w-[110px] md:w-[140px] justify-between px-2 md:px-3",
              countryButtonClassName
            )}
          >
            <span className="truncate flex items-center gap-1 md:gap-2">
              <span className="text-lg">{country.flag}</span>
              <span className="text-sm truncate">{country.dial_code}</span>
            </span>
            <ChevronsUpDown className="ml-1 md:ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(300px,90vw)] p-0" align="start">
          <div className="flex flex-col">
            <div className="flex items-center border-b px-3">
              <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
              <input
                className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Buscar país..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
            </div>
            <div className="max-h-[300px] overflow-y-auto p-1">
              {filteredCountries.length === 0 ? (
                <div className="py-6 text-center text-sm">
                  No se encontró el país.
                </div>
              ) : (
                filteredCountries.map((c) => (
                  <div
                    key={c.code}
                    className={cn(
                      "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                      country.code === c.code && "bg-accent"
                    )}
                    onClick={() => handleCountrySelect(c)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        country.code === c.code ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="mr-2 text-lg">{c.flag}</span>
                    <span className="font-medium mr-2">{c.name}</span>
                    <span className="ml-auto text-muted-foreground text-xs">
                      {c.dial_code}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <Input
        type="tel"
        value={localNumber}
        onChange={handleNumberChange}
        placeholder={placeholder}
        className="min-w-0 flex-1"
      />
    </div>
  );
}
