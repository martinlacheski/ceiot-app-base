export interface SensorVariable {
  code: string;
  name: string;
  unit: string;
  min: number;
  max: number;
  accuracy: string;
  resolution: string;
}

export interface SensorCatalogModel {
  id: string;
  code: string;
  name: string;
  manufacturer: string;
  variables: SensorVariable[];
}

export interface DeviceSensor {
  id: string;
  deviceId: string;
  sensorId: string;
  key: string;
  config: Record<string, unknown>;
  isActive: boolean;
  installedAt: string | null;
  removedAt: string | null;
}

export interface TelemetryVariable {
  code: string;
  name: string;
  unit: string;
}

export interface TelemetrySensor {
  key: string;
  sensorCode: string;
  sensorName: string;
  variables: TelemetryVariable[];
}

export interface TelemetryItem {
  time: string;
  values: Record<string, Record<string, number | null>>;
}

export interface TelemetryPage {
  items: TelemetryItem[];
  total: number;
  sensors: TelemetrySensor[];
  page?: number;
  perPage?: number;
  pages?: number;
}
