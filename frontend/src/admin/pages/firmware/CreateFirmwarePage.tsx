import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { firmwareKeys, firmwareService, getFirmwareErrorMessage } from "@/app/services/firmware.service";
import type { FirmwareUploadRequest } from "@/app/types/firmware.types";
import { FileInput } from "@/components/custom/FileInput";
import { FormPageLayout } from "@/components/custom/FormPageLayout";
import {
  FULL_PAGE_FORM_ACTION_BUTTON_CLASS,
  FULL_PAGE_FORM_ACTIONS_CLASS,
  FULL_PAGE_FORM_BACK_LABEL,
} from "@/components/custom/fullPageFormActions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  describeBuild,
  FIRMWARE_PROJECT,
  parseAppDescriptor,
  readFileHead,
  type AppDescriptor,
} from "./appDescriptor";

const LIST_URL = "/admin/firmware";
const INVALID_FILE = "El archivo no es un firmware ESP32 válido";
const wrongProject = (project: string) =>
  `El archivo es del proyecto '${project}', no del firmware de los dispositivos (${FIRMWARE_PROJECT})`;

const uploadedMessage = (version: string, deactivated: number) => {
  if (deactivated <= 0) return `Firmware ${version} subido`;
  const what = deactivated === 1 ? "versión anterior desactivada" : "versiones anteriores desactivadas";
  return `Firmware ${version} subido · ${deactivated} ${what}`;
};

export function CreateFirmwarePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [descriptor, setDescriptor] = useState<AppDescriptor | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [deactivatePrevious, setDeactivatePrevious] = useState(true);
  // A later pick wins over a slower read of an earlier one.
  const latestRead = useRef(0);

  const upload = useMutation({
    mutationFn: (request: FirmwareUploadRequest) => firmwareService.uploadRelease(request),
    onSuccess: (release) => {
      toast.success(uploadedMessage(release.version, release.deactivatedPrevious ?? 0));
      void queryClient.invalidateQueries({ queryKey: firmwareKeys.all });
      navigate(LIST_URL);
    },
    onError: (error) => toast.error(getFirmwareErrorMessage(error, "No se pudo subir el firmware")),
  });

  // The version lives inside the image: it is read from the file head, never typed.
  const onFileChange = async (next: File | null) => {
    const read = ++latestRead.current;
    setFile(next);
    setDescriptor(null);
    setFileError(null);
    setNotes("");
    if (!next) return;
    let parsed: AppDescriptor | null = null;
    try {
      parsed = parseAppDescriptor(await readFileHead(next));
    } catch {
      parsed = null;
    }
    if (read !== latestRead.current) return;
    if (!parsed || !parsed.version) {
      setFileError(INVALID_FILE);
      return;
    }
    if (parsed.projectName !== FIRMWARE_PROJECT) {
      setFileError(wrongProject(parsed.projectName));
      return;
    }
    setDescriptor(parsed);
    setNotes(describeBuild(parsed));
  };

  const canSubmit = file !== null && descriptor !== null && !upload.isPending;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!file || !descriptor || !canSubmit) return;
    upload.mutate({ file, version: descriptor.version, notes: notes.trim() || undefined, deactivatePrevious });
  };

  return (
    <FormPageLayout
      title="Nuevo firmware"
      subtitle="Sube una imagen de firmware para actualizar los dispositivos."
      backUrl={LIST_URL}
    >
      <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-2">
        <FileInput
          id="firmware-file"
          label="Archivo de firmware (.bin)"
          accept=".bin"
          value={file}
          onChange={(next) => void onFileChange(next)}
        />
        <div className="space-y-2">
          <Label htmlFor="firmware-version">Versión</Label>
          <Input
            id="firmware-version"
            value={descriptor?.version ?? ""}
            readOnly
            placeholder="Se completa al elegir el archivo"
            className="h-11 bg-muted text-muted-foreground"
          />
          {descriptor ? (
            <p className="text-xs text-muted-foreground">{describeBuild(descriptor)}</p>
          ) : (
            <p className="text-xs text-muted-foreground">Detectada del archivo</p>
          )}
          {fileError && (
            <p role="alert" className="text-sm text-destructive">
              {fileError}
            </p>
          )}
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="firmware-notes">Notas</Label>
          <Input
            id="firmware-notes"
            className="h-11"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 md:col-span-2">
          <Checkbox
            id="firmware-deactivate-previous"
            checked={deactivatePrevious}
            onCheckedChange={(checked) => setDeactivatePrevious(checked === true)}
          />
          <Label htmlFor="firmware-deactivate-previous">Desactivar las versiones anteriores</Label>
        </div>
        <div className={`${FULL_PAGE_FORM_ACTIONS_CLASS} md:col-span-2`}>
          <Button
            type="button"
            variant="outline"
            className={FULL_PAGE_FORM_ACTION_BUTTON_CLASS}
            onClick={() => navigate(LIST_URL)}
          >
            {FULL_PAGE_FORM_BACK_LABEL}
          </Button>
          <Button type="submit" className={FULL_PAGE_FORM_ACTION_BUTTON_CLASS} disabled={!canSubmit}>
            {upload.isPending ? "Subiendo..." : "Subir firmware"}
          </Button>
        </div>
      </form>
    </FormPageLayout>
  );
}

export default CreateFirmwarePage;
