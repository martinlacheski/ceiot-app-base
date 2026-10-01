import { useRef, useState, type DragEvent } from "react";
import { FileUp, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { documentErrorMessage, documentsApi } from "./documentsApi";
import { DOCUMENT_ACCEPT, MAX_DOCUMENT_BYTES, formatBytes, validateDocumentFile } from "./documentUtils";

type EntryStatus = "queued" | "uploading" | "done" | "failed";

interface Entry {
  key: string;
  file: File;
  status: EntryStatus;
  progress: number;
  message: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once after every batch that uploaded at least one file. */
  onUploaded: () => void;
}

let counter = 0;
const newEntry = (file: File): Entry => {
  const invalid = validateDocumentFile(file);
  counter += 1;
  return { key: `${counter}-${file.name}`, file, status: invalid ? "failed" : "queued", progress: 0, message: invalid };
};

export function UploadDocumentDialog({ open, onOpenChange, onUploaded }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const patch = (key: string, changes: Partial<Entry>) =>
    setEntries((current) => current.map((entry) => (entry.key === key ? { ...entry, ...changes } : entry)));

  const addFiles = (files: FileList | File[] | null) => {
    if (!files || busy) return;
    setEntries((current) => [...current, ...Array.from(files).map(newEntry)]);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  };

  const queued = entries.filter((entry) => entry.status === "queued");

  const startUpload = async () => {
    setBusy(true);
    let uploaded = 0;
    for (const entry of queued) {
      patch(entry.key, { status: "uploading", progress: 0, message: null });
      try {
        await documentsApi.upload(entry.file, (percent) => patch(entry.key, { progress: percent }));
        patch(entry.key, { status: "done", progress: 100 });
        uploaded += 1;
      } catch (error) {
        patch(entry.key, { status: "failed", message: documentErrorMessage(error, "No se pudo subir el archivo.") });
      }
    }
    setBusy(false);
    if (uploaded > 0) onUploaded();
  };

  const handleOpenChange = (next: boolean) => {
    if (busy) return;
    if (!next) setEntries([]);
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Subir documentos</DialogTitle>
          <DialogDescription>
            PDF, TXT, MD o DOCX, hasta {MAX_DOCUMENT_BYTES / (1024 * 1024)} MB por archivo.
          </DialogDescription>
        </DialogHeader>

        <div
          data-testid="document-dropzone"
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center gap-2 rounded-md border-2 border-dashed p-6 text-center text-sm text-muted-foreground ${dragging ? "border-primary bg-accent" : "border-input"}`}
        >
          <FileUp className="size-6" aria-hidden />
          <p>Arrastrá los archivos acá o</p>
          <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={() => inputRef.current?.click()}>
            Seleccionar archivos
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            accept={DOCUMENT_ACCEPT}
            aria-label="Archivos a subir"
            onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }}
          />
        </div>

        {entries.length > 0 && (
          <ul className="max-h-60 space-y-2 overflow-y-auto" aria-label="Archivos seleccionados">
            {entries.map((entry) => (
              <li key={entry.key} className="rounded-md border p-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{entry.file.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(entry.file.size)}</span>
                  {entry.status === "queued" && !busy && (
                    <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`Quitar ${entry.file.name}`}
                      onClick={() => setEntries((current) => current.filter((item) => item.key !== entry.key))}>
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
                {entry.status === "uploading" && (
                  <div className="mt-2 h-2 w-full overflow-hidden rounded bg-secondary" role="progressbar" aria-label={`Progreso de ${entry.file.name}`}
                    aria-valuemin={0} aria-valuemax={100} aria-valuenow={entry.progress}>
                    <div className="h-full bg-primary transition-[width]" style={{ width: `${entry.progress}%` }} />
                  </div>
                )}
                {entry.status === "done" && <p className="mt-1 text-xs text-muted-foreground">Subido correctamente.</p>}
                {entry.status === "failed" && entry.message && <p role="alert" className="mt-1 text-xs text-destructive">{entry.message}</p>}
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={() => handleOpenChange(false)}>
            Cerrar
          </Button>
          <Button type="button" className="h-11" disabled={busy || queued.length === 0} onClick={startUpload}>
            {busy && <Loader2 className="animate-spin" data-icon="inline-start" />}
            Subir{queued.length > 0 ? ` (${queued.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
