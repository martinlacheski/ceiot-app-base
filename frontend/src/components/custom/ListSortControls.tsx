import { useId } from "react";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type ListSortDirection = "asc" | "desc";

interface ListSortOption<TValue extends string> {
  value: TValue;
  label: string;
}

interface ListSortControlsProps<TValue extends string> {
  options: readonly ListSortOption<TValue>[];
  value?: TValue;
  direction: ListSortDirection;
  onValueChange: (value: TValue | undefined) => void;
  onDirectionChange: (direction: ListSortDirection) => void;
}

export function ListSortControls<TValue extends string>({
  options,
  value,
  direction,
  onValueChange,
  onDirectionChange,
}: ListSortControlsProps<TValue>) {
  const fieldId = useId();
  const directionId = useId();

  return (
    <>
      <div className="flex min-w-0 flex-col gap-2">
        <label className="text-sm font-medium" htmlFor={fieldId}>
          Ordenar por
        </label>
        <Select
          value={value ?? "none"}
          onValueChange={(nextValue) =>
            onValueChange(nextValue === "none" ? undefined : (nextValue as TValue))
          }
        >
          <SelectTrigger id={fieldId} className="min-h-11 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="none">Sin ordenar</SelectItem>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <label className="text-sm font-medium" htmlFor={directionId}>
          Dirección
        </label>
        <Select
          value={direction}
          onValueChange={(nextValue) =>
            onDirectionChange(nextValue as ListSortDirection)
          }
          disabled={!value}
        >
          <SelectTrigger id={directionId} className="min-h-11 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="asc">Ascendente</SelectItem>
              <SelectItem value="desc">Descendente</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </>
  );
}
