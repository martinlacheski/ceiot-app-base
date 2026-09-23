import { getBooleanLabel } from "@/utils/status-labels";
export const formatHistoryBoolean = getBooleanLabel;
const numberFormatter = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1, useGrouping: false });
export const formatHistoryReading = (value: number | null | undefined, unit: string) => value == null ? "-" : `${numberFormatter.format(value)} ${unit}`;
