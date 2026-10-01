import type { ExportCell } from "@/lib/export.cells";
import type { HistoryColumn } from "./HistoryResultsTable";

/** The export cell of a history column: its typed cell, or its displayed value as text. */
export const exportCellOf = <T,>(column: HistoryColumn<T>, item: T): ExportCell =>
  column.exportValue ? column.exportValue(item) : String(column.value(item));
