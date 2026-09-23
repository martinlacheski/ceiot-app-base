import { useState } from "react";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  InfoWindow,
} from "@vis.gl/react-google-maps";
import type { DeviceMapItem } from "@/interfaces/device-map.interface";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Eye } from "lucide-react";
import { getConnectionStatusLabel } from "@/utils/status-labels";

interface MapContainerProps {
  devices: DeviceMapItem[];
}

export function MapContainer({ devices }: MapContainerProps) {
  const navigate = useNavigate();
  const [selectedDevice, setSelectedDevice] = useState<DeviceMapItem | null>(
    null,
  );

  // Center of Argentina
  const defaultCenter = { lat: -38.4161, lng: -63.6167 };
  const defaultZoom = 4;

  const handleMarkerClick = (device: DeviceMapItem) => {
    setSelectedDevice(device);
  };

  const handleCloseInfoWindow = () => {
    setSelectedDevice(null);
  };

  return (
    <div className="h-[350px] sm:h-[450px] md:h-[550px] lg:h-[600px] w-full relative z-0 rounded-lg border overflow-hidden">
      <APIProvider
        apiKey={import.meta.env.VITE_GCP_API_KEY}
        language="es"
        region="AR"
      >
        <Map
          style={{ width: "100%", height: "100%" }}
          defaultCenter={defaultCenter}
          defaultZoom={defaultZoom}
          mapId="IOT_MAP_ID"
          gestureHandling={"greedy"}
          disableDefaultUI={false}
        >
          {devices.map((device) => {
            const isOnline = device.status === "online";

            // Colors matching the previous implementation and design system
            // Green: #22c55e (Tailwind green-500)
            // Red: #ef4444 (Tailwind red-500)
            const pinColor = isOnline ? "#22c55e" : "#ef4444";
            const borderColor = "#ffffff";
            const glyphColor = "#ffffff";

            return (
              <AdvancedMarker
                key={device.id}
                position={{
                  lat: device.location.lat,
                  lng: device.location.lng,
                }}
                onClick={() => handleMarkerClick(device)}
                title={device.name}
              >
                <div
                  className="h-4 w-4 rounded-full border-2 shadow"
                  style={{
                    backgroundColor: pinColor,
                    borderColor,
                    color: glyphColor,
                  }}
                />
              </AdvancedMarker>
            );
          })}

          {selectedDevice && (
            <InfoWindow
              position={{
                lat: selectedDevice.location.lat,
                lng: selectedDevice.location.lng,
              }}
              onCloseClick={handleCloseInfoWindow}
              minWidth={250}
            >
              <div className="min-w-[250px] p-1">
                <h3 className="font-bold mb-2 text-base text-black">
                  {selectedDevice.name}
                </h3>
                <p className="text-gray-500 text-sm mb-1">
                  {selectedDevice.location.address}
                </p>
                <p className="text-gray-500 text-sm mb-3">
                  {selectedDevice.location.city}
                </p>

                <div className="flex gap-2 mb-3">
                  <span
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium"
                    style={{
                      backgroundColor:
                        selectedDevice.status === "online"
                          ? "#dcfce7" // green-100
                          : "#fee2e2", // red-100
                      color:
                        selectedDevice.status === "online"
                          ? "#166534" // green-800
                          : "#991b1b", // red-800
                    }}
                  >
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        backgroundColor:
                          selectedDevice.status === "online"
                            ? "#22c55e"
                            : "#ef4444",
                        borderRadius: "50%",
                      }}
                    />
                    {getConnectionStatusLabel(selectedDevice.status)}
                  </span>
                </div>

                <Button
                  className="w-full text-white hover:text-white/90"
                  onClick={() =>
                    navigate(`/app/devices/${selectedDevice.id}`, {
                      state: { from: "/app/map" },
                    })
                  }
                >
                  <Eye className="mr-2 h-4 w-4" />
                  Ver detalles
                </Button>
              </div>
            </InfoWindow>
          )}
        </Map>
      </APIProvider>
    </div>
  );
}
