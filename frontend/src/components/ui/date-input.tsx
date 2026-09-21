import { Input } from "./input";
import { cn } from "@/lib/utils";

export interface DateInputProps {
  value: Date | undefined | null;
  onChange: (date: Date) => void;
  className?: string;
}

export const DateInput: React.FC<DateInputProps> = ({ value, onChange, className }) => {
  const dateString = value
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
    : "";

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val) {
      // Handle empty case if needed, or ignoring?
      // Current interface implies Date is required in onChange?
      // Parent logic handles it. If val is empty, we can't emit a valid Date.
      // If we want to support clearing, we might need nullable Date in onChange.
      // For now, retaining existing behavior: only emit if valid date.
      return;
    }
    const [year, month, day] = val.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    if (!isNaN(date.getTime())) {
      onChange(date);
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLInputElement>) => {
    if (typeof e.currentTarget.showPicker !== "function") return;

    try {
      e.currentTarget.showPicker();
      e.preventDefault();
    } catch {
      // Let the browser's native click behavior handle unsupported contexts.
    }
  };

  return (
    <Input
      type="date"
      value={dateString}
      onClick={handleClick}
      onChange={handleChange}
      className={cn("h-8 w-full px-2 py-1 text-xs", className)}
    />
  );
};
