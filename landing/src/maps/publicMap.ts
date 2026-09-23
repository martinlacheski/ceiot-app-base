export interface PublicLocation {
  displayName: string;
  latitude: number;
  longitude: number;
  city?: string;
  state?: string;
  country?: string;
  activeDeviceCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOptionalString(value: unknown): value is string | undefined {
  return typeof value === "string" || typeof value === "undefined";
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isLatitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

function isLongitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}

export function normalizePublicLocations(payload: unknown): PublicLocation[] {
  if (!Array.isArray(payload)) return [];

  return payload.flatMap((item) => {
    if (!isRecord(item)) return [];
    const { displayName, latitude, longitude, city, state, country, activeDeviceCount } = item;
    if (
      typeof displayName !== "string"
      || !isLatitude(latitude)
      || !isLongitude(longitude)
      || !isOptionalString(city)
      || !isOptionalString(state)
      || !isOptionalString(country)
      || !isNonNegativeInteger(activeDeviceCount)
    ) {
      return [];
    }

    return [{
      displayName,
      latitude,
      longitude,
      ...(city ? { city } : {}),
      ...(state ? { state } : {}),
      ...(country ? { country } : {}),
      activeDeviceCount,
    }];
  });
}
