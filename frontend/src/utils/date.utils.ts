import { format, formatDistanceToNow, isValid } from "date-fns";
import { es } from "date-fns/locale";

/**
 * Parsea un timestamp de la API a `Date`.
 * La API devuelve instantes con zona explícita (`Z` / `+00:00`); un timestamp sin zona
 * (formato legado) se toma como UTC. Una fecha pura `YYYY-MM-DD` es un día local.
 */
export function parseApiDateTime(
  date: string | Date | null | undefined,
): Date | null {
  if (!date) return null;
  if (date instanceof Date) return isValid(date) ? date : null;

  let dateStr = date.trim();
  if (!dateStr) return null;

  // Fecha pura YYYY-MM-DD: se parsea localmente para evitar el salto de día por UTC.
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [year, month, day] = dateStr.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}/.test(dateStr)) {
    dateStr = dateStr.replace(" ", "T");
  }

  // Sin zona explícita (Z o ±hh:mm): UTC "naive".
  const hasZone = /[Zz]$/.test(dateStr) || /[+-]\d\d:?\d\d$/.test(dateStr);
  const parsed = new Date(hasZone ? dateStr : `${dateStr}Z`);
  return isValid(parsed) ? parsed : null;
}

/**
 * Formatea una fecha a un string legible en formato 24h, en la hora local del navegador.
 * @param date fecha en string (ISO) o objeto Date
 * @param formatStr string de formato (default: dd/MM/yyyy HH:mm)
 */
export function formatDateTime(
  date: string | Date | null | undefined,
  formatStr: string = "dd/MM/yyyy HH:mm",
): string {
  const dateObj = parseApiDateTime(date);
  if (!dateObj) return "-";

  return format(dateObj, formatStr, { locale: es });
}

/**
 * Formatea solo la fecha.
 */
export function formatDate(
  date: string | Date | null | undefined,
  formatStr: string = "dd/MM/yyyy",
): string {
  if (!date) return "-";

  // Si es un string, extraemos solo la parte de la fecha (YYYY-MM-DD)
  if (typeof date === "string") {
    const datePart = date.split("T")[0];
    if (datePart.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const [year, month, day] = datePart.split("-");
      // Retornar en el formato solicitado ignorando timezones
      if (formatStr === "dd/MM/yyyy") return `${day}/${month}/${year}`;
      if (formatStr === "dd-MM-yyyy") return `${day}-${month}-${year}`;
    }
  }

  return formatDateTime(date, formatStr);
}

/**
 * Formatea solo la hora.
 */
export function formatTime(
  date: string | Date | null | undefined,
  formatStr: string = "HH:mm",
): string {
  return formatDateTime(date, formatStr);
}

/**
 * Formatea una fecha como distancia relativa a "ahora" ("hace 3 días"),
 * reutilizando el mismo manejo de zona horaria que formatDateTime.
 */
export function formatRelativeTime(
  date: string | Date | null | undefined,
): string {
  if (!date) return "-";
  const parsed = new Date(formatDateTime(date, "yyyy-MM-dd'T'HH:mm:ss"));
  if (!isValid(parsed)) return "-";
  return formatDistanceToNow(parsed, { addSuffix: true, locale: es });
}
