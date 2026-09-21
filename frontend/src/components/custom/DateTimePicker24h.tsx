import { useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface DateTimePicker24hProps {
  value?: Date;
  onChange: (date: Date | undefined) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  "aria-describedby"?: string;
  className?: string;
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MINUTES = Array.from({ length: 12 }, (_, index) => index * 5);

const setDateTimePart = (
  date: Date | undefined,
  part: "hours" | "minutes",
  nextValue: number,
) => {
  const nextDate = new Date(date ?? new Date());

  if (part === "hours") {
    nextDate.setHours(nextValue);
  } else {
    nextDate.setMinutes(nextValue);
  }

  nextDate.setSeconds(0, 0);
  return nextDate;
};

const mergeDateWithCurrentTime = (selectedDate: Date, currentValue?: Date) => {
  const nextDate = new Date(selectedDate);

  if (currentValue) {
    nextDate.setHours(currentValue.getHours(), currentValue.getMinutes(), 0, 0);
    return nextDate;
  }

  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
};

export function DateTimePicker24h({
  value,
  onChange,
  id,
  placeholder = "Seleccioná fecha y hora",
  disabled = false,
  "aria-describedby": ariaDescribedBy,
  className,
}: DateTimePicker24hProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-describedby={ariaDescribedBy}
          className={cn(
            "w-full justify-between text-left font-normal",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <span>
            {value ? format(value, "dd/MM/yyyy HH:mm", { locale: es }) : placeholder}
          </span>
          <CalendarIcon className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="z-[110] w-auto p-0" align="start">
        <div className="flex flex-col sm:flex-row">
          <Calendar
            mode="single"
            selected={value}
            onSelect={(selectedDate) => {
              onChange(
                selectedDate ? mergeDateWithCurrentTime(selectedDate, value) : undefined,
              );
            }}
            locale={es}
            initialFocus
            defaultMonth={value ?? new Date()}
          />
          <div className="flex gap-3 border-t p-3 sm:border-l sm:border-t-0">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Hora</p>
            <ScrollArea className="h-60 w-20 rounded-md border sm:h-[18.5rem]">
              <div className="space-y-1 p-1">
                {HOURS.map((hour) => {
                  const isSelected = value?.getHours() === hour;

                  return (
                    <Button
                      key={hour}
                      type="button"
                      variant={isSelected ? "default" : "ghost"}
                      className="w-full justify-center"
                      onClick={() => onChange(setDateTimePart(value, "hours", hour))}
                    >
                      {String(hour).padStart(2, "0")}
                    </Button>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Minutos</p>
            <ScrollArea className="h-60 w-20 rounded-md border sm:h-[18.5rem]">
              <div className="space-y-1 p-1">
                {MINUTES.map((minute) => {
                  const isSelected = value?.getMinutes() === minute;

                  return (
                    <Button
                      key={minute}
                      type="button"
                      variant={isSelected ? "default" : "ghost"}
                      className="w-full justify-center"
                      onClick={() => onChange(setDateTimePart(value, "minutes", minute))}
                    >
                      {String(minute).padStart(2, "0")}
                    </Button>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
