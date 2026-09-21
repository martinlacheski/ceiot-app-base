import { format } from "date-fns";
import { es } from "date-fns/locale";

export const createDefaultAccessStart = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
};

export const formatAccessStartLabel = (value?: string) => {
  if (!value) {
    return "Desde hoy 00:00";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Desde hoy 00:00";
  }

  return `Desde ${format(date, "dd/MM/yyyy HH:mm", { locale: es })}`;
};

export const toLocalDateTimePayload = (value: Date) => {
  return format(value, "yyyy-MM-dd'T'HH:mm:ss");
};
