interface PlaceAddressComponent {
  longText?: string | null;
  shortText?: string | null;
  long_name?: string;
  short_name?: string;
  types?: string[];
}

interface PlaceAddressSource {
  formattedAddress?: string | null;
  formatted_address?: string;
  addressComponents?: PlaceAddressComponent[];
  address_components?: PlaceAddressComponent[];
}

interface PlaceSelectionSource extends PlaceAddressSource {
  displayName?: string | null;
  name?: string | null;
  internationalPhoneNumber?: string | null;
  international_phone_number?: string | null;
  primaryTypeDisplayName?: string | null;
  types?: string[];
  location?: unknown;
  geometry?: {
    location?: unknown;
  };
}

export interface NormalizedPlaceSelection extends PlaceAddressSource {
  displayName?: string | null;
  name?: string | null;
  internationalPhoneNumber?: string | null;
  international_phone_number?: string | null;
  primaryTypeDisplayName?: string | null;
  types?: string[];
  location?: unknown;
  geometry?: {
    location?: unknown;
  };
}

const PRIORITY_LOCALITY_TYPES = [
  "locality",
  "administrative_area_level_3",
  "administrative_area_level_2",
  "sublocality",
  "neighborhood",
] as const;

function getComponentText(component: PlaceAddressComponent | undefined): string {
  return (
    component?.longText ??
    component?.long_name ??
    component?.shortText ??
    component?.short_name ??
    ""
  ).trim();
}

function getAddressComponents(place: PlaceAddressSource): PlaceAddressComponent[] {
  return place.addressComponents ?? place.address_components ?? [];
}

function findAddressComponent(
  components: PlaceAddressComponent[],
  type: string,
): PlaceAddressComponent | undefined {
  return components.find((component) => component.types?.includes(type));
}

function buildStreetLine(components: PlaceAddressComponent[]): string {
  const route = getComponentText(findAddressComponent(components, "route"));
  const streetNumber = getComponentText(
    findAddressComponent(components, "street_number"),
  );

  if (!route || !streetNumber) {
    return "";
  }

  return `${route} ${streetNumber}`;
}

function normalizeAddressText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function getFirstFormattedSegment(value: string): string {
  return value.split(",")[0]?.trim() ?? "";
}

function looksLikePostalCodeSegment(segment: string): boolean {
  const compactSegment = segment.replace(/\s+/g, " ").trim();

  return /^(?:[a-z]\d{4}[a-z]{0,3}|\d{4,8})\b/i.test(compactSegment);
}

function hasStreetNumberPattern(segment: string): boolean {
  return /\d{1,5}[a-z]?\b/i.test(segment);
}

function looksLikeSpecificFormattedAddress(
  formattedAddress: string,
  components: PlaceAddressComponent[],
): boolean {
  const firstSegment = getFirstFormattedSegment(formattedAddress);

  if (!firstSegment) {
    return false;
  }

  if (!/[\p{L}]/u.test(firstSegment) || !hasStreetNumberPattern(firstSegment)) {
    return false;
  }

  if (looksLikePostalCodeSegment(firstSegment)) {
    return false;
  }

  const route = getComponentText(findAddressComponent(components, "route"));
  if (route) {
    return normalizeAddressText(firstSegment).includes(normalizeAddressText(route));
  }

  return firstSegment.split(/\s+/).length >= 2;
}

export function hasPrecisePlaceStreetAddress(
  place: PlaceAddressSource | null | undefined,
): boolean {
  if (!place) {
    return false;
  }

  const components = getAddressComponents(place);
  const formattedAddress = getFormattedAddress(place);

  return (
    looksLikeSpecificFormattedAddress(formattedAddress, components) ||
    Boolean(buildStreetLine(components))
  );
}

function buildLocalityLine(components: PlaceAddressComponent[]): string[] {
  const localityParts = PRIORITY_LOCALITY_TYPES.map((type) =>
    getComponentText(findAddressComponent(components, type)),
  ).filter(Boolean);

  const province = getComponentText(
    findAddressComponent(components, "administrative_area_level_1"),
  );
  const country = getComponentText(findAddressComponent(components, "country"));

  return [...localityParts, province, country].filter(
    (value, index, values) => values.indexOf(value) === index,
  );
}

function getFormattedAddress(place: PlaceAddressSource): string {
  return (place.formattedAddress ?? place.formatted_address ?? "").trim();
}

export function getBestPlaceAddress(place: PlaceAddressSource | null | undefined): string {
  if (!place) {
    return "";
  }

  const formattedAddress = getFormattedAddress(place);
  const components = getAddressComponents(place);

  if (looksLikeSpecificFormattedAddress(formattedAddress, components)) {
    return formattedAddress;
  }

  const streetLine = buildStreetLine(components);
  if (streetLine) {
    return [streetLine, ...buildLocalityLine(components)].join(", ");
  }

  return formattedAddress;
}

export function normalizePlaceSelection(
  place: PlaceSelectionSource | null | undefined,
  preciseAddress?: string,
): NormalizedPlaceSelection | null {
  if (!place) {
    return null;
  }

  const location = place.location ?? place.geometry?.location;
  const formattedAddress = preciseAddress || getBestPlaceAddress(place);
  const addressComponents = getAddressComponents(place);
  const phone =
    place.internationalPhoneNumber ?? place.international_phone_number ?? null;

  return {
    addressComponents,
    address_components: addressComponents,
    displayName: place.displayName ?? null,
    name: place.name ?? null,
    formattedAddress,
    formatted_address: formattedAddress,
    geometry: place.geometry ?? (location ? { location } : undefined),
    internationalPhoneNumber: phone,
    international_phone_number: phone,
    location,
    primaryTypeDisplayName: place.primaryTypeDisplayName ?? null,
    types: place.types ?? [],
  };
}
