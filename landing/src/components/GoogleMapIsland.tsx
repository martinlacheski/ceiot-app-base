import { useEffect, useState } from "react";
import { AdvancedMarker, APIProvider, InfoWindow, Map } from "@vis.gl/react-google-maps";

import {
  PUBLIC_MAP_FALLBACK_URL,
  PUBLIC_MAP_LOCATIONS_URL,
} from "../config/publicUrls";
import type { LandingContent } from "../i18n/content";
import type { PublicLocation } from "../maps/publicMap";
import { createPublicMapLoader } from "../maps/publicMapLoader";

type MapContent = LandingContent["map"];

const DEFAULT_CENTER = { lat: -38.4161, lng: -63.6167 };
const DEFAULT_ZOOM = 4;
const SELECTED_ZOOM = 13;

function deviceCountLabel(content: MapContent, count: number): string {
  const template = count === 1
    ? content.activeDeviceCountSingular
    : content.activeDeviceCount;
  return template.replace("{count}", String(count));
}

export function GoogleMapIsland({ content }: { content: MapContent }) {
  const apiKey = import.meta.env.PUBLIC_GCP_MAPS_API_KEY as string | undefined;
  const [locations, setLocations] = useState<PublicLocation[]>([]);
  const [selected, setSelected] = useState<PublicLocation | null>(null);

  useEffect(() => {
    const loader = createPublicMapLoader({
      url: PUBLIC_MAP_LOCATIONS_URL,
      fallbackUrl: PUBLIC_MAP_FALLBACK_URL,
      onLocations: setLocations,
    });
    loader.start();
    return () => loader.stop();
  }, []);

  if (!apiKey?.trim()) {
    return (
      <div className="flex h-full items-center justify-center bg-muted/50 p-8 text-center">
        <p className="max-w-xl text-sm text-muted-foreground">{content.missingApiKey}</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden">
      <APIProvider apiKey={apiKey} language={content.language} region={content.region}>
        <Map
          style={{ width: "100%", height: "100%" }}
          defaultCenter={DEFAULT_CENTER}
          defaultZoom={DEFAULT_ZOOM}
          center={selected ? { lat: selected.latitude, lng: selected.longitude } : undefined}
          zoom={selected ? SELECTED_ZOOM : undefined}
          mapId="DEMO_MAP_ID"
          gestureHandling="greedy"
          disableDefaultUI={false}
        >
          {locations.map((location) => (
            <AdvancedMarker
              key={`${location.displayName}-${location.latitude}-${location.longitude}`}
              position={{ lat: location.latitude, lng: location.longitude }}
              onClick={() => setSelected(location)}
              title={location.displayName}
            >
              <div className="relative flex h-5 w-5 -translate-y-1 items-center justify-center rounded-full border-[3px] border-white bg-neutral-900 shadow-lg shadow-black/40 transition hover:scale-110">
                <span className="h-1.5 w-1.5 rounded-full bg-white" />
                <span className="absolute -bottom-1 h-2 w-2 rotate-45 rounded-[2px] bg-neutral-900 shadow-black/40" />
              </div>
            </AdvancedMarker>
          ))}

          {selected && (
            <InfoWindow
              position={{ lat: selected.latitude, lng: selected.longitude }}
              minWidth={180}
              maxWidth={280}
              headerDisabled
            >
              <div className="relative min-w-44 max-w-64 p-0.5 pr-7 text-neutral-900">
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  aria-label={content.closeLabel}
                  className="absolute -top-1.5 right-0 flex h-7 w-7 items-center justify-center text-xl leading-none text-neutral-500 hover:text-neutral-900"
                >
                  ×
                </button>
                <h3 className="text-sm font-semibold leading-tight">{selected.displayName}</h3>
                <p className="text-xs leading-5 text-neutral-600">
                  {[selected.city, selected.state, selected.country].filter(Boolean).join(", ")}
                </p>
                <p className="mt-1 text-xs font-medium text-neutral-700">
                  {deviceCountLabel(content, selected.activeDeviceCount)}
                </p>
              </div>
            </InfoWindow>
          )}
        </Map>
      </APIProvider>
    </div>
  );
}
