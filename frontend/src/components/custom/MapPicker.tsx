/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resolveLocationAction } from "@/admin/actions/location.actions";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import icon from "leaflet/dist/images/marker-icon.png";
import iconShadow from "leaflet/dist/images/marker-shadow.png";

// Fix Leaflet default icon issue
const DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

L.Marker.prototype.options.icon = DefaultIcon;

interface MapPickerProps {
  value?: string; // The location string (link or lat,long) stored in DB
  onChange: (value: string) => void;
  onLocationResolved: (data: any) => void;
  defaultPosition?: [number, number];
}

// Click Handler Component
function LocationMarker({
  onLocationFound,
}: {
  onLocationFound: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      onLocationFound(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export function MapPicker({
  value,
  onChange,
  onLocationResolved,
  defaultPosition = [-26.5695, -54.7536], // Default near specified user location or generic
}: MapPickerProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [position, setPosition] = useState<[number, number]>(defaultPosition);
  const mapRef = useRef<L.Map>(null);

  // Derived state for marker from value prop
  const markerPosition: [number, number] | null = (() => {
    if (!value) return null;
    const match = value.match(/([-+]?\d{1,2}\.\d+),\s*([-+]?\d{1,3}\.\d+)/);
    if (match) {
      return [parseFloat(match[1]), parseFloat(match[2])];
    }
    return null;
  })();

  const handleResolve = async (input: string) => {
    if (!input) return;
    setIsLoading(true);
    try {
      const data = await resolveLocationAction(input);
      // Update Inputs
      onChange(input); // Keep the input as the "value"

      // Update map center if we have coords
      if (data.latitude && data.longitude) {
        const newPos: [number, number] = [data.latitude, data.longitude];
        setPosition(newPos);
        mapRef.current?.flyTo(newPos, 15);
      }

      // Callback to parent form
      onLocationResolved(data);
    } catch (error: any) {
      toast.error(
        error.response?.data?.detail || "No se pudo resolver la ubicación"
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleManualSearch = (inputVal: string) => {
    handleResolve(inputVal);
  };

  const handleMapClick = (lat: number, lng: number) => {
    const coordString = `${lat},${lng}`;
    onChange(coordString);
    // Optimization: Don't necessarily resolve address on every click to save API calls?
    // Or do we? The original code did handleResolve(coordString).
    // Let's keep it consistent.
    handleResolve(coordString);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          placeholder="Pegue un enlace de Google Maps o coordenadas, o haga clic en el mapa"
          value={value || ""}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          onKeyDown={(e) =>
            e.key === "Enter" &&
            (e.preventDefault(), handleManualSearch(e.currentTarget.value))
          }
        />
        <Button
          type="button"
          variant="secondary"
          onClick={() => handleManualSearch(value || "")}
          disabled={isLoading}
        >
          {isLoading ? <Loader2 className="animate-spin" /> : <Search />}
        </Button>
      </div>

      <div className="h-[300px] w-full rounded-md border overflow-hidden relative z-0">
        <MapContainer
          ref={mapRef}
          center={position}
          zoom={13}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <LocationMarker onLocationFound={handleMapClick} />
          {markerPosition && (
            <Marker position={markerPosition}>
              <Popup>Ubicación Seleccionada</Popup>
            </Marker>
          )}
        </MapContainer>
      </div>
    </div>
  );
}
