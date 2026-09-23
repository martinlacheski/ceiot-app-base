import { useId } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL_VALUE = "all";

interface ListSelectFilterProps {
  label: string;
  /** Selected raw code; undefined means "no filter". */
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  options: { value: string; label: string }[];
  allLabel?: string;
}

/** Labelled select for a filters panel, with a first option that clears the filter. */
export function ListSelectFilter({
  label,
  value,
  onChange,
  options,
  allLabel = "Todos",
}: ListSelectFilterProps) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select
        value={value ?? ALL_VALUE}
        onValueChange={(next) => onChange(next === ALL_VALUE ? undefined : next)}
      >
        <SelectTrigger aria-label={label} className="min-h-11 w-full">
          <SelectValue placeholder={allLabel} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_VALUE}>{allLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

interface ListNumberFilterProps {
  label: string;
  /** Typed text; the caller debounces and parses it. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  step?: string;
  /** Lower bound: sets the input's min and ignores typed values below it. */
  min?: number;
}

/** Labelled numeric input for a filters panel (amount or temperature bounds). */
export function ListNumberFilter({
  label,
  value,
  onChange,
  placeholder,
  step = "any",
  min,
}: ListNumberFilterProps) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        placeholder={placeholder}
        value={value}
        onChange={(event) => {
          const text = event.target.value;
          if (min !== undefined && text !== "" && Number(text) < min) return;
          onChange(text);
        }}
        className="min-h-11"
      />
    </div>
  );
}

interface ListTextFilterProps {
  label: string;
  /** Typed text; the caller debounces it. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/** Labelled free-text input for a filters panel (exact-match values such as a firmware version). */
export function ListTextFilter({ label, value, onChange, placeholder }: ListTextFilterProps) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11"
      />
    </div>
  );
}
