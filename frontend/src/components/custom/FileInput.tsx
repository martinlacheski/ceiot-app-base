import { FileUp, X } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatFileSize } from "@/lib/fileSize";
import { cn } from "@/lib/utils";

interface FileInputProps {
  id: string;
  label: string;
  value: File | null;
  onChange: (file: File | null) => void;
  /** Comma-separated extensions such as ".bin"; other files are rejected client-side. */
  accept?: string;
  className?: string;
}

const matchesAccept = (file: File, accept: string | undefined) => {
  if (!accept) return true;
  const name = file.name.toLowerCase();
  return accept
    .split(",")
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean)
    .some((extension) => name.endsWith(extension));
};

/** File picker styled like the app's inputs: a hidden native input behind an outline button that
 * shows the chosen file's name and size, with a "Quitar" button once something is selected. */
export function FileInput({ id, label, value, onChange, accept, className }: FileInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const errorId = `${id}-error`;

  const handleChange = (file: File | undefined) => {
    if (!file) return;
    if (!matchesAccept(file, accept)) {
      setError(`El archivo debe ser de tipo ${accept}`);
      return;
    }
    setError(null);
    onChange(file);
  };

  const clear = () => {
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
    onChange(null);
  };

  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Button
          id={id}
          type="button"
          variant="outline"
          className="min-h-11"
          aria-describedby={error ? errorId : undefined}
          onClick={() => inputRef.current?.click()}
        >
          <FileUp data-icon="inline-start" />
          Seleccionar archivo
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="file-input-native"
          onChange={(event) => handleChange(event.target.files?.[0])}
        />
        {value ? (
          <>
            <span className="min-w-0 truncate text-sm">
              {value.name} · {formatFileSize(value.size)}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Quitar archivo"
              onClick={clear}
            >
              <X className="size-4" />
            </Button>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">Ningún archivo seleccionado</span>
        )}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
