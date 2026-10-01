import { cn } from "@/lib/utils";
import type { ChatMessage, ChatSource } from "./chatApi";

const MAX_TABLE_ROWS = 20;

const cell = (value: unknown): string => {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const relevance = (distance: number) => Math.max(0, Math.min(100, Math.round((1 - distance) * 100)));

const location = (source: ChatSource) =>
  source.page !== null ? `p. ${source.page}` : source.section ? `sección ${source.section}` : "sin ubicación";

/** Everything below renders model/document output as React text children: never as HTML. */
export function AssistantMessage({ message, isAdmin }: { message: ChatMessage; isAdmin: boolean }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
          {message.content}
        </p>
      </div>
    );
  }

  if (message.error) {
    return (
      <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {message.content}
      </p>
    );
  }

  const { response } = message;
  const sql = response?.sql ?? null;
  const shownRows = sql ? sql.rows.slice(0, MAX_TABLE_ROWS) : [];
  return (
    <div className="flex max-w-[95%] flex-col gap-2">
      <p className="whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm text-foreground">
        {message.content}
      </p>

      {response?.warnings.map((warning, index) => (
        <p key={index} className="rounded-md border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
          {warning}
        </p>
      ))}

      {sql && (
        <details className="rounded-md border border-border bg-card text-xs">
          <summary className="min-h-11 cursor-pointer select-none px-3 py-3 font-medium text-foreground">
            Datos ({sql.rows.length} {sql.rows.length === 1 ? "fila" : "filas"})
          </summary>
          <div className="space-y-2 px-3 pb-3">
            {sql.rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr>
                      {sql.columns.map((column) => (
                        <th key={column} scope="col" className="border-b border-border px-2 py-1 font-medium text-foreground">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shownRows.map((row, index) => (
                      <tr key={index}>
                        {sql.columns.map((column) => (
                          <td key={column} className="border-b border-border/60 px-2 py-1 text-muted-foreground">
                            {cell(row[column])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(sql.truncated || sql.rows.length > shownRows.length) && (
              <p className="text-muted-foreground">
                Mostrando {shownRows.length} de {sql.truncated ? "más de " : ""}
                {sql.rows.length} filas.
              </p>
            )}
            {isAdmin && (
              <pre className={cn("overflow-x-auto rounded bg-muted p-2 font-mono text-[11px] text-foreground")}>
                {sql.query}
              </pre>
            )}
          </div>
        </details>
      )}

      {response && response.sources.length > 0 && (
        <section aria-label="Fuentes" className="space-y-1 text-xs">
          <h3 className="font-medium text-foreground">Fuentes</h3>
          <ul className="space-y-1">
            {response.sources.map((source, index) => (
              <li key={`${source.documentId}-${index}`} className="rounded-md border border-border bg-card px-2 py-1.5">
                <span className="font-medium text-foreground">{source.title}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {location(source)} · relevancia {relevance(source.distance)} %
                </span>
                {source.section && source.page !== null && (
                  <span className="text-muted-foreground"> · sección {source.section}</span>
                )}
                <p className="mt-0.5 line-clamp-2 text-muted-foreground">{source.excerpt}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
