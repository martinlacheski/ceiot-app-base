import { appApi } from "@/api/appApi";

import type { SensorReadingListResponse } from "../types/sensorReading.types";

const BASE_URL = "/devices";

export const sensorReadingService = {
  getLatest: async (
    deviceId: string,
    limit?: number,
  ): Promise<SensorReadingListResponse> => {
    const params = new URLSearchParams();
    if (limit !== undefined) params.append("limit", limit.toString());

    const { data } = await appApi.get<SensorReadingListResponse>(
      `${BASE_URL}/${deviceId}/sensor-readings/latest`,
      { params },
    );
    return data;
  },

  getHistory: async (
    deviceId: string,
    start: string,
    end: string,
  ): Promise<SensorReadingListResponse> => {
    const params = new URLSearchParams();
    params.append("start", start);
    params.append("end", end);

    const { data } = await appApi.get<SensorReadingListResponse>(
      `${BASE_URL}/${deviceId}/sensor-readings/history`,
      { params },
    );
    return data;
  },
};
