import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { type Column } from "@tanstack/react-table";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface DataTableColumnHeaderProps<TData, TValue>
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  column: Column<TData, TValue>;
  title: string | ReactNode;
  align?: "start" | "center" | "end";
  hideReset?: boolean;
  triggerClassName?: string;
}

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
  align = "start",
  hideReset = false,
  triggerClassName,
}: DataTableColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort()) {
    return (
      <div className={cn(align === "end" && "text-right", align === "center" && "text-center", className)}>
        {title}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center space-x-2",
        align === "end" && "justify-end",
        align === "center" && "w-full justify-center",
        align === "start" && "justify-start",
        className,
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 data-[state=open]:bg-accent",
              align === "end" && "-mr-3",
              align === "start" && "-ml-3",
              triggerClassName,
            )}
          >
            <span>{title}</span>
            {column.getIsSorted() === "desc" ? (
              <ArrowDown className="ml-2 h-4 w-4" />
            ) : column.getIsSorted() === "asc" ? (
              <ArrowUp className="ml-2 h-4 w-4" />
            ) : (
              <ChevronsUpDown className="ml-2 h-4 w-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onClick={(e) => column.toggleSorting(false, e.shiftKey)}
          >
            <ArrowUp className="mr-2 h-3.5 w-3.5 text-muted-foreground/70" />
            Asc
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => column.toggleSorting(true, e.shiftKey)}
          >
            <ArrowDown className="mr-2 h-3.5 w-3.5 text-muted-foreground/70" />
            Desc
          </DropdownMenuItem>
          {!hideReset && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => column.clearSorting()}>
                <ChevronsUpDown className="mr-2 h-3.5 w-3.5 text-muted-foreground/70" />
                Reset
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
