import { deviceHistoryApi, type HistoryOperation } from "@/api/deviceHistory.api";
import { ListSelectFilter } from "@/components/custom/ListFilterFields";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/utils/date.utils";
import { OPERATION_STATUS_LABELS, OPERATION_TYPE_OPTIONS, getOperationStatusLabel, getOperationTypeLabel } from "@/utils/status-labels";
import { HistoryTabBase } from "./HistoryTabBase";
import type { ReactNode } from "react";
export function HistoryOperationsTab({ serial, environmentId, dateFrom, dateTo, dateSelector }: { serial: string; environmentId: string; dateFrom?: string; dateTo?: string; dateSelector: ReactNode }) {
  return <HistoryTabBase<HistoryOperation> kind="operations" serial={serial} environmentId={environmentId} dateFrom={dateFrom} dateTo={dateTo} dateSelector={dateSelector}
    fetchRows={({ filters, ...params }) => deviceHistoryApi.operations(serial, { ...params, environmentId, status: filters.status, operationType: filters.operationType })}
    filterFields={(setFilter, filters) => <>
      <ListSelectFilter label="Tipo" value={filters.operationType} onChange={(value) => setFilter("operationType", value)} options={OPERATION_TYPE_OPTIONS} />
      <ListSelectFilter label="Estado" value={filters.status} onChange={(value) => setFilter("status", value)} options={Object.entries(OPERATION_STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
    </>}
    columns={[
      { id: "time", title: "Fecha/Hora", value: (item) => formatDateTime(item.time), sortable: true },
      { id: "operation_type", title: "Tipo", value: (item) => getOperationTypeLabel(item.operationType), sortable: true },
      { id: "status", title: "Estado", value: (item) => getOperationStatusLabel(item.status), sortable: true },
    ]}
    mobile={(rows) => <div className="grid gap-3 md:hidden">{rows.map((item) => <Card key={item.id} role="article"><CardHeader><CardTitle>{formatDateTime(item.time)}</CardTitle></CardHeader><CardContent className="text-sm"><p>{getOperationTypeLabel(item.operationType)}</p><p>{getOperationStatusLabel(item.status)}</p></CardContent></Card>)}</div>}
  />;
}
