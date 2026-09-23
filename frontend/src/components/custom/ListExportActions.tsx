import { FileSpreadsheet, FileText } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export type ListExportFormat = "excel" | "pdf";

interface ListExportActionsProps {
  /** Builds and downloads the file; the caller owns the data, filename and layout. */
  onExport: (format: ListExportFormat) => Promise<void>;
  disabled?: boolean;
}

/** Standard Excel/PDF row, placed between the toolbar and the table. */
export function ListExportActions({ onExport, disabled = false }: ListExportActionsProps) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async (format: ListExportFormat) => {
    setIsExporting(true);
    try {
      await onExport(format);
    } catch {
      toast.error("Error al generar el reporte");
    } finally {
      setIsExporting(false);
    }
  };

  const isDisabled = disabled || isExporting;

  return (
    <div className="flex justify-end" data-testid="list-export-actions">
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={isDisabled}
          onClick={() => handleExport("excel")}
        >
          <FileSpreadsheet className="size-4 text-green-600" />
          <span className="hidden sm:inline">Excel</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={isDisabled}
          onClick={() => handleExport("pdf")}
        >
          <FileText className="size-4 text-red-600" />
          <span className="hidden sm:inline">PDF</span>
        </Button>
      </div>
    </div>
  );
}
