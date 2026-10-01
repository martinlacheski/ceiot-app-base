import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { MessageCircle, RotateCcw, SendHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useAuthStore } from "@/auth/store/auth.store";
import { cn } from "@/lib/utils";
import { AssistantMessage } from "./AssistantMessage";
import { MAX_QUESTION_CHARS, MIN_QUESTION_CHARS, type ChatMode } from "./chatApi";
import { useAssistantChat } from "./useAssistantChat";

const EXAMPLES = [
  "¿Cuál fue la temperatura promedio por día esta semana?",
  "¿Qué precisión tiene el DHT22?",
  "¿Cuál es la última humedad medida por cada dispositivo?",
  "¿Cada cuánto hay que calibrar los sensores?",
];

const MODES: { value: ChatMode; label: string }[] = [
  { value: "auto", label: "Automático" },
  { value: "datos", label: "Datos" },
  { value: "documentos", label: "Documentos" },
];

/** Floating assistant (text-to-SQL + RAG) available on every authenticated page. */
export function AssistantChat() {
  const userId = useAuthStore((state) => state.user?.id);
  return <AssistantChatPanel key={userId ?? "anonymous"} />;
}

function AssistantChatPanel() {
  const user = useAuthStore((state) => state.user);
  const isAdmin = Boolean(user?.isAdmin);
  const canReadData = (user?.permissions ?? []).includes("telemetry:read");
  const { messages, pending, send, reset } = useAssistantChat();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ChatMode>("auto");
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  const effectiveMode: ChatMode = mode === "datos" && !canReadData ? "auto" : mode;
  const canSend = draft.trim().length >= MIN_QUESTION_CHARS;

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages, pending]);

  const submit = (question: string) => {
    if (question.trim().length < MIN_QUESTION_CHARS) return;
    setDraft("");
    void send(question, effectiveMode);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit(draft);
    }
  };

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 h-11 min-w-11 gap-2 rounded-full px-4 shadow-lg"
      >
        <MessageCircle aria-hidden className="size-5" />
        Asistente
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          closeLabel="Cerrar asistente"
          className="w-full gap-0 p-0 sm:max-w-md"
          aria-describedby="assistant-description"
        >
          <SheetHeader className="space-y-1 border-b border-border p-4 pr-14">
            <SheetTitle>Asistente</SheetTitle>
            <SheetDescription id="assistant-description">
              Consultá los datos de tus dispositivos y los documentos cargados.
            </SheetDescription>
            <div className="pt-1">
              <Button type="button" variant="ghost" size="sm" className="h-11 gap-2 px-2" onClick={reset}>
                <RotateCcw aria-hidden className="size-4" />
                Nueva conversación
              </Button>
            </div>
          </SheetHeader>

          <div role="log" aria-live="polite" aria-label="Conversación" className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Probá con una de estas preguntas:</p>
                <div className="flex flex-wrap gap-2">
                  {EXAMPLES.map((example) => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => submit(example)}
                      disabled={pending}
                      className="min-h-11 rounded-full border border-border bg-card px-3 py-2 text-left text-sm text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message) => (
              <AssistantMessage key={message.id} message={message} isAdmin={isAdmin} />
            ))}
            {pending && (
              <p role="status" className="text-sm text-muted-foreground">
                Pensando…
              </p>
            )}
            <div ref={endRef} />
          </div>

          <div className="space-y-2 border-t border-border p-3">
            <div role="group" aria-label="Modo" className="flex gap-1">
              {MODES.map(({ value, label }) => {
                const disabled = value === "datos" && !canReadData;
                return (
                  <button
                    key={value}
                    type="button"
                    disabled={disabled}
                    aria-pressed={effectiveMode === value}
                    title={disabled ? "Requiere permiso de lectura de telemetría" : undefined}
                    onClick={() => setMode(value)}
                    className={cn(
                      "min-h-11 flex-1 rounded-md border px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                      effectiveMode === value
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-foreground hover:bg-accent",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="flex items-end gap-2">
              <Textarea
                aria-label="Pregunta"
                value={draft}
                maxLength={MAX_QUESTION_CHARS}
                rows={2}
                placeholder="Escribí tu pregunta…"
                className="min-h-11 flex-1 resize-none"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKeyDown}
              />
              <Button type="button" size="icon" className="size-11" aria-label="Enviar" disabled={!canSend} onClick={() => submit(draft)}>
                <SendHorizontal aria-hidden className="size-5" />
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
