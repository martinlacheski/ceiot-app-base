export interface SensorReading {
  id: string;
  time: string;
  deviceId: string | null;
  deviceSerial: string;
  deviceType: string;
  temperatureC: number | null;
  relativeHumidityPct: number | null;
  pressureHpa: number | null;
  powerSupplyState?: boolean | null;
  uptime?: number | null;
  firmwareVersion?: string | null;
  resetReason?: string | null;
  heapFree?: number | null;
  wifiRssi?: number | null;
  wifiSsid?: string | null;
  wifiIp?: string | null;
  lastError?: string | null;
  extraData?: Record<string, unknown> | null;
  deviceDatetime?: string | null;
}

export interface SensorReadingListResponse {
  items: SensorReading[];
  total: number;
}
