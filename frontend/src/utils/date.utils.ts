import { format, formatDistanceToNow, isValid } from "date-fns";
import { es } from "date-fns/locale";

/**
 * Formatea una fecha a un string legible en formato 24h.
 * Maneja conversion de Timezone (Browser Local Time) asegurando que el input se trate como UTC si es necesario.
 * @param date fecha en string (ISO) o objeto Date
 * @param formatStr string de formato (default: dd/MM/yyyy HH:mm)
 */
export function formatDateTime(
  date: string | Date | null | undefined,
  formatStr: string = "dd/MM/yyyy HH:mm",
): string {
  if (!date) return "-";

  let dateObj: Date;

  if (typeof date === "string") {
    let dateStr = date.trim();

    // Si es una fecha pura YYYY-MM-DD sin hora, la parseamos localmente
    // para evitar el salto de día por UTC.
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const [year, month, day] = dateStr.split("-").map(Number);
      dateObj = new Date(year, month - 1, day);
    } 
    // Si tiene hora, seguimos el flujo normal con UTC conversion
    else if (dateStr.match(/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}/)) {
      dateStr = dateStr.replace(" ", "T");
      // ... resto de la lógica ...
    }

    // Si viene sin timezone explícito (Z o +...), asumimos que es UTC "naive"
    // y le agregamos Z para que el navegador lo parsee como UTC y lo convierta a Local.
    if (
      !dateStr.includes("Z") &&
      !dateStr.includes("+") &&
      !dateStr.match(/-\d\d:?\d\d$/)
    ) {
      dateObj = new Date(dateStr + "Z");
    } else {
      dateObj = new Date(dateStr);
    }
  } else {
    dateObj = date;
  }

  if (!isValid(dateObj)) return "-";

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
