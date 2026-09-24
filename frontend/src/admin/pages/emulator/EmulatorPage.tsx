import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { PageHeader } from "@/app/components/PageHeader";
import { SearchableSelect } from "@/components/custom/SearchableSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { formatTime } from "@/utils/date.utils";
import { useDevices } from "@/app/hooks/useDevices";
import { DEVICE_SORT_BY } from "@/app/types/device.types";
import type { Device } from "@/app/types/device.types";
import {
  useEmulatorSensors,
  useRequestEmulatorTime,
  useSendEmulatorTelemetry,
  type EmulatorSensor,
} from "@/app/hooks/useEmulator";

const DEVICE_SEARCH_DEBOUNCE_MS = 300;
const DEVICES_PER_PAGE = 50;
const RANDOM_STEP_RATIO = 0.05;
const MAX_LOG_ENTRIES = 50;
const DEFAULT_AUTO_INTERVAL_SECONDS = 5;

type EmulatorValues = Record<string, Record<string, number>>;

interface LogEntry {
  id: string;
  time: Date;
  message: string;
  result: "success" | "error";
  detail?: string;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}

function randomWalk(
  previous: EmulatorValues,
  sensors: EmulatorSensor[],
): EmulatorValues {
  const next: EmulatorValues = {};
  for (const sensor of sensors) {
    next[sensor.key] = {};
    for (const variable of sensor.variables) {
      const current =
        previous[sensor.key]?.[variable.code] ??
        (variable.minValue + variable.maxValue) / 2;
      const range = variable.maxValue - variable.minValue;
      const step = range * RANDOM_STEP_RATIO * (Math.random() * 2 - 1);
      next[sensor.key][variable.code] = roundTo2(
        clamp(current + step, variable.minValue, variable.maxValue),
      );
    }
  }
  return next;
}

function formatReadingMessage(
  values: EmulatorValues,
  sensors: EmulatorSensor[],
): string {
  return sensors
    .filter((sensor) => values[sensor.key])
    .map((sensor) => {
      const parts = sensor.variables
        .filter((variable) => values[sensor.key]?.[variable.code] !== undefined)
        .map(
          (variable) =>
            `${variable.code}=${values[sensor.key][variable.code].toFixed(2)}`,
        );
      return `${sensor.sensorCode}: ${parts.join(", ")}`;
    })
    .join(" | ");
}

function getErrorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof (error as { response?: { data?: { detail?: string } } }).response
      ?.data?.detail === "string"
  ) {
    return (error as { response: { data: { detail: string } } }).response.data
      .detail;
  }
  return "No se pudo enviar la lectura";
}

let logIdSeq = 0;
function makeLogId(): string {
  logIdSeq += 1;
  return `log-${logIdSeq}`;
}

export default function EmulatorPage() {
  const [selectedDevice, setSelectedDevice] = useState<Device | undefined>();
  const [deviceSearchInput, setDeviceSearchInput] = useState("");
  const deviceSearch = useDebouncedValue(
    deviceSearchInput.trim(),
    DEVICE_SEARCH_DEBOUNCE_MS,
  );

  const { data: devicesData, isLoading: devicesLoading } = useDevices({
    page: 1,
    perPage: DEVICES_PER_PAGE,
    search: deviceSearch || undefined,
    sortBy: DEVICE_SORT_BY.SERIAL,
    sortOrder: "asc",
  });
  const devices = devicesData?.items ?? [];

  const { data: sensors, isLoading: sensorsLoading } = useEmulatorSensors(
    selectedDevice?.id,
  );
  const sensorsList = sensors ?? [];

  const [values, setValues] = useState<EmulatorValues>({});
  const [log, setLog] = useState<LogEntry[]>([]);
  const [autoRunning, setAutoRunning] = useState(false);
  const [intervalSeconds, setIntervalSeconds] = useState(
    DEFAULT_AUTO_INTERVAL_SECONDS,
  );

  const sendTelemetry = useSendEmulatorTelemetry();
  const requestTime = useRequestEmulatorTime();

  const appendLog = useCallback((entry: LogEntry) => {
    setLog((prev) => [entry, ...prev].slice(0, MAX_LOG_ENTRIES));
  }, []);

  // Reset per-device state whenever the selected device changes.
  useEffect(() => {
    setValues({});
    setLog([]);
    setAutoRunning(false);
  }, [selectedDevice?.id]);

  // Seed control values at the midpoint of each variable's range once the
  // device's active sensors (and their catalog ranges) are loaded. Existing
  // edits are preserved across refetches.
  useEffect(() => {
    if (!sensorsList.length) return;
    setValues((prev) => {
      const next: EmulatorValues = { ...prev };
      for (const sensor of sensorsList) {
        next[sensor.key] = { ...next[sensor.key] };
        for (const variable of sensor.variables) {
          if (next[sensor.key][variable.code] === undefined) {
            next[sensor.key][variable.code] = roundTo2(
              (variable.minValue + variable.maxValue) / 2,
            );
          }
        }
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sensorsList.map((s) => s.key).join(","), selectedDevice?.id]);

  const deviceIdRef = useRef<string | undefined>(selectedDevice?.id);
  useEffect(() => {
    deviceIdRef.current = selectedDevice?.id;
  }, [selectedDevice?.id]);

  const sendReading = useCallback(
    async (vals: EmulatorValues, sensorsForMessage: EmulatorSensor[]) => {
      const deviceId = deviceIdRef.current;
      if (!deviceId) return;
      try {
        const response = await sendTelemetry.mutateAsync({
          deviceId,
          body: { sensors: vals },
        });
        appendLog({
          id: makeLogId(),
          time: new Date(),
          message: formatReadingMessage(vals, sensorsForMessage),
          result: "success",
          detail: response.topic,
        });
      } catch (error) {
        appendLog({
          id: makeLogId(),
          time: new Date(),
          message: formatReadingMessage(vals, sensorsForMessage),
          result: "error",
          detail: getErrorMessage(error),
        });
      }
    },
    [appendLog, sendTelemetry],
  );

  const sendReadingRef = useRef(sendReading);
  useEffect(() => {
    sendReadingRef.current = sendReading;
  }, [sendReading]);

  const sensorsRef = useRef<EmulatorSensor[]>(sensorsList);
  useEffect(() => {
    sensorsRef.current = sensorsList;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sensorsList.map((s) => s.key).join(",")]);

  // Auto mode: every `intervalSeconds`, walk every variable by a small
  // bounded random step and send the resulting reading.
  useEffect(() => {
    if (!autoRunning) return;
    const ms = Math.max(1, intervalSeconds) * 1000;
    const id = setInterval(() => {
      setValues((prev) => {
        const next = randomWalk(prev, sensorsRef.current);
        void sendReadingRef.current(next, sensorsRef.current);
        return next;
      });
    }, ms);
    return () => clearInterval(id);
  }, [autoRunning, intervalSeconds]);

  const handleSetValue = (
    sensorKey: string,
    variableCode: string,
    raw: number,
    min: number,
    max: number,
  ) => {
    setValues((prev) => ({
      ...prev,
      [sensorKey]: {
        ...prev[sensorKey],
        [variableCode]: roundTo2(clamp(raw, min, max)),
      },
    }));
  };

  const handleSendNow = () => {
    void sendReadingRef.current(values, sensorsList);
  };

  const handleToggleAuto = () => {
    setAutoRunning((prev) => !prev);
  };

  const handleTestTimeRequest = async () => {
    if (!selectedDevice) return;
    try {
      const response = await requestTime.mutateAsync(selectedDevice.id);
      appendLog({
        id: makeLogId(),
        time: new Date(),
        message: `Pedido de hora (reqId=${response.reqId})`,
        result: "success",
        detail: response.topic,
      });
    } catch (error) {
      appendLog({
        id: makeLogId(),
        time: new Date(),
        message: "Pedido de hora",
        result: "error",
        detail: getErrorMessage(error),
      });
    }
  };

  const hasSensors = sensorsList.length > 0;
  const canSend = Boolean(selectedDevice) && hasSensors;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Emulador de dispositivo"
        subtitle="Genera lecturas y pedidos de hora sin hardware, para pruebas y demos"
        backUrl="/admin/devices"
      />

      <Card>
        <CardHeader>
          <CardTitle>Dispositivo</CardTitle>
          <CardDescription>
            Elegí el dispositivo a emular por serial o nombre
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SearchableSelect
            options={devices.map((device) => ({
              value: device.id,
              label: `${device.serial} — ${device.name}`,
            }))}
            value={selectedDevice?.id}
            selectedLabel={
              selectedDevice
                ? `${selectedDevice.serial} — ${selectedDevice.name}`
                : undefined
            }
            onChange={(id) =>
              setSelectedDevice(devices.find((device) => device.id === id))
            }
            onSearchChange={setDeviceSearchInput}
            shouldFilter={false}
            isLoading={devicesLoading}
            placeholder="Seleccionar dispositivo"
            searchPlaceholder="Buscar por serial o nombre..."
            emptyMessage="No se encontraron dispositivos"
          />
          {selectedDevice && (
            <p className="mt-2 text-sm text-muted-foreground">
              <Link
                to={`/app/devices/${selectedDevice.id}`}
                className="underline underline-offset-2 hover:text-foreground"
              >
                Ver detalle y telemetría del dispositivo
              </Link>
            </p>
          )}
        </CardContent>
      </Card>

      {selectedDevice && (
        <Card>
          <CardHeader>
            <CardTitle>Lecturas emuladas</CardTitle>
            <CardDescription>
              {sensorsLoading
                ? "Cargando sensores instalados..."
                : hasSensors
                  ? "Ajustá cada variable y enviá una lectura o iniciá el envío automático"
                  : "Este dispositivo no tiene sensores activos instalados"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {sensorsList.map((sensor) => (
              <div key={sensor.key} className="space-y-4">
                <h3 className="font-medium">
                  {sensor.sensorName}{" "}
                  <span className="text-sm text-muted-foreground">
                    ({sensor.key})
                  </span>
                </h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  {sensor.variables.map((variable) => {
                    const value =
                      values[sensor.key]?.[variable.code] ??
                      (variable.minValue + variable.maxValue) / 2;
                    return (
                      <div key={variable.code} className="space-y-1.5">
                        <label className="text-sm font-medium">
                          {variable.name} ({variable.unit}) — [
                          {variable.minValue}, {variable.maxValue}]
                        </label>
                        <div className="flex items-center gap-3">
                          <input
                            type="range"
                            aria-label={`${sensor.sensorName} ${variable.name} deslizador`}
                            min={variable.minValue}
                            max={variable.maxValue}
                            step="any"
                            value={value}
                            onChange={(event) =>
                              handleSetValue(
                                sensor.key,
                                variable.code,
                                Number(event.target.value),
                                variable.minValue,
                                variable.maxValue,
                              )
                            }
                            className="h-11 w-full accent-primary"
                          />
                          <Input
                            type="number"
                            aria-label={`${sensor.sensorName} ${variable.name} numérico`}
                            min={variable.minValue}
                            max={variable.maxValue}
                            step="any"
                            value={value}
                            onChange={(event) =>
                              handleSetValue(
                                sensor.key,
                                variable.code,
                                Number(event.target.value),
                                variable.minValue,
                                variable.maxValue,
                              )
                            }
                            className="h-11 w-28 shrink-0"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {hasSensors && (
              <div className="flex flex-wrap items-end gap-3 border-t pt-4">
                <Button
                  type="button"
                  className="h-11"
                  onClick={handleSendNow}
                  disabled={!canSend || sendTelemetry.isPending}
                >
                  Enviar lectura
                </Button>

                <div className="flex items-end gap-2">
                  <label className="space-y-1 text-sm">
                    Cada (s)
                    <Input
                      type="number"
                      min={1}
                      className="h-11 w-20"
                      value={intervalSeconds}
                      disabled={autoRunning}
                      onChange={(event) =>
                        setIntervalSeconds(
                          Math.max(1, Number(event.target.value) || 1),
                        )
                      }
                    />
                  </label>
                  <Button
                    type="button"
                    variant={autoRunning ? "destructive" : "outline"}
                    className="h-11"
                    onClick={handleToggleAuto}
                    disabled={!canSend}
                  >
                    {autoRunning
                      ? "Detener envío automático"
                      : "Envío automático cada N s"}
                  </Button>
                </div>
              </div>
            )}

            <div className="border-t pt-4">
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={handleTestTimeRequest}
                disabled={requestTime.isPending}
              >
                Probar pedido de hora
              </Button>
              <p className="mt-2 text-sm text-muted-foreground">
                La respuesta de sincronización de hora no puede verse desde el
                navegador: revisá los logs del contenedor mqtt-runtime.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {selectedDevice && log.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Registro de envíos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Hora</TableHead>
                    <TableHead>Sensor/variables enviadas</TableHead>
                    <TableHead>Resultado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {log.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>{formatTime(entry.time, "HH:mm:ss")}</TableCell>
                      <TableCell>{entry.message}</TableCell>
                      <TableCell>
                        {entry.result === "success" ? "Éxito" : "Error"}
                        {entry.detail ? ` — ${entry.detail}` : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
