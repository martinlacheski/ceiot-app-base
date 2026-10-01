import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DocumentItem } from "./documentsApi";

const MAX_TITLE = 255;

interface Props {
  document: DocumentItem | null;
  onClose: () => void;
  onSave: (document: DocumentItem, title: string) => Promise<void>;
}

export function RenameDocumentDialog({ document, onClose, onSave }: Props) {
  return (
    <Dialog open={document !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {document && <RenameForm key={document.id} document={document} onClose={onClose} onSave={onSave} />}
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({ document, onClose, onSave }: { document: DocumentItem; onClose: () => void; onSave: Props["onSave"] }) {
  const [title, setTitle] = useState(document.title);
  const [saving, setSaving] = useState(false);
  const trimmed = title.trim();
  const invalid = trimmed.length === 0 || trimmed.length > MAX_TITLE;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (invalid) return;
    setSaving(true);
    try {
      await onSave(document, trimmed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Renombrar documento</DialogTitle>
        <DialogDescription>El archivo original ({document.filename}) no cambia.</DialogDescription>
      </DialogHeader>
      <label className="space-y-1 text-sm">
        Título
        <input
          aria-label="Título"
          className="h-11 w-full rounded-md border border-input bg-background px-3 text-foreground"
          value={title}
          maxLength={MAX_TITLE}
          autoFocus
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <DialogFooter>
        <Button type="button" variant="outline" className="h-11" onClick={onClose}>Cancelar</Button>
        <Button type="submit" className="h-11" disabled={invalid || saving}>Guardar</Button>
      </DialogFooter>
    </form>
  );
}
