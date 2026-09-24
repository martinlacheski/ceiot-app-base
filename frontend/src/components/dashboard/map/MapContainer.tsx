import { useState } from "react";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  AdvancedMarkerAnchorPoint,
  InfoWindow,
} from "@vis.gl/react-google-maps";
import type { DeviceMapItem } from "@/interfaces/device-map.interface";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Eye } from "lucide-react";
import { getConnectionStatusLabel } from "@/utils/status-labels";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import { computeDotLayout } from "./dotLayout";
import { groupDevicesByLocation } from "./groupDevicesByLocation";

interface MapContainerProps {
  devices: DeviceMapItem[];
}

// Colors matching the previous implementation and design system
// Green: #22c55e (Tailwind green-500)
// Red: #ef4444 (Tailwind red-500)
const STATUS_MARKER_COLOR: Record<DeviceMapItem["status"], string> = {
  online: "#22c55e",
  offline: "#ef4444",
};

const STATUS_BADGE_STYLE: Record<
  DeviceMapItem["status"],
  { background: string; text: string; dot: string }
> = {
  online: { background: "#dcfce7", text: "#166534", dot: "#22c55e" },
  offline: { background: "#fee2e2", text: "#991b1b", dot: "#ef4444" },
};

const MAX_DOTS = 8;
const DOT_SIZE = 16;
// Dots of a shared location overlap this fraction of their diameter, so the
// group stays about as big as a single dot instead of spreading over the map.
const DOT_OVERLAP = 0.6;

function StatusBadge({ status }: { status: DeviceMapItem["status"] }) {
  const style = STATUS_BADGE_STYLE[status];
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium"
      style={{ backgroundColor: style.background, color: style.text }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          backgroundColor: style.dot,
          borderRadius: "50%",
        }}
      />
      {getConnectionStatusLabel(status)}
    </span>
  );
}

function DeviceStatusRow({
  device,
  onDetails,
  buttonClassName,
}: {
  device: DeviceMapItem;
  onDetails: () => void;
  buttonClassName?: string;
}) {
  return (
    <div>
      <div className="flex gap-2 mb-2 flex-wrap items-center">
        <StatusBadge status={device.status} />
      </div>
      <Button
        className={cn("w-full text-white hover:text-white/90", buttonClassName)}
        onClick={onDetails}
      >
        <Eye className="mr-2 h-4 w-4" />
        Ver detalles
      </Button>
    </div>
  );
}

// Below Tailwind `md`, where the InfoWindow bubble is too small for the details.
const SMALL_SCREEN_QUERY = "(max-width: 767px)";

function LocationDevices({
  group,
  onDetails,
  nameClassName,
  buttonClassName,
}: {
  group: { devices: DeviceMapItem[] };
  onDetails: (device: DeviceMapItem) => void;
  nameClassName?: string;
  buttonClassName?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      {group.devices.map((device) => (
        <div key={device.id}>
          {group.devices.length > 1 && (
            <h4 className={cn("font-semibold mb-1 text-sm", nameClassName)}>
              {device.name}
            </h4>
          )}
          <DeviceStatusRow
            device={device}
            onDetails={() => onDetails(device)}
            buttonClassName={buttonClassName}
          />
        </div>
      ))}
    </div>
  );
}

export function MapContainer({ devices }: MapContainerProps) {
  const navigate = useNavigate();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const isSmallScreen = useMediaQuery(SMALL_SCREEN_QUERY);

  // Center of Argentina
  const defaultCenter = { lat: -38.4161, lng: -63.6167 };
  const defaultZoom = 4;

  const groups = groupDevicesByLocation(devices);
  const selectedGroup = groups.find((g) => g.key === selectedKey) ?? null;

  const openDetails = (device: DeviceMapItem) =>
    navigate(`/app/devices/${device.id}`, {
      state: { from: "/app/map" },
    });

  return (
    <div className="h-[350px] sm:h-[450px] md:h-[550px] lg:h-[600px] w-full relative z-0 rounded-lg border overflow-hidden">
      <APIProvider
        apiKey={import.meta.env.VITE_GCP_API_KEY}
        language="es"
      >
        <Map
          style={{ width: "100%", height: "100%" }}
          defaultCenter={defaultCenter}
          defaultZoom={defaultZoom}
          mapId="IOT_MAP_ID"
          gestureHandling={"greedy"}
          disableDefaultUI={false}
        >
          {groups.map((group) => {
            const first = group.devices[0];
            const count = group.devices.length;
            const shown = group.devices.slice(0, MAX_DOTS);
            const extra = count - shown.length;
            const layout = computeDotLayout(shown.length, {
              dotSize: DOT_SIZE,
              gap: -DOT_SIZE * DOT_OVERLAP,
              padding: 0,
            });
            const title =
              count === 1
                ? first.name
                : `${first.location.address || first.name}: ${count} dispositivos`;

            return (
              <AdvancedMarker
                key={group.key}
                position={{ lat: group.lat, lng: group.lng }}
                onClick={() => setSelectedKey(group.key)}
                title={title}
                anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
              >
                {count === 1 ? (
                  <div
                    data-testid="device-dot"
                    className="h-4 w-4 rounded-full border-2 shadow"
                    style={{
                      backgroundColor: STATUS_MARKER_COLOR[first.status],
                      borderColor: "#ffffff",
                      color: "#ffffff",
                    }}
                  />
                ) : (
                  <div className="relative">
                    <div
                      className="relative"
                      style={{ width: layout.badgeSize, height: layout.badgeSize }}
                    >
                      {shown.map((device, i) => (
                        <div
                          key={device.id}
                          data-testid="device-dot"
                          className="absolute rounded-full border-2 shadow"
                          style={{
                            width: DOT_SIZE,
                            height: DOT_SIZE,
                            left: layout.badgeSize / 2 + layout.dots[i].x - DOT_SIZE / 2,
                            top: layout.badgeSize / 2 + layout.dots[i].y - DOT_SIZE / 2,
                            backgroundColor: STATUS_MARKER_COLOR[device.status],
                            borderColor: "#ffffff",
                          }}
                        />
                      ))}
                    </div>
                    {extra > 0 && (
                      <span className="absolute left-1/2 top-full -translate-x-1/2 -mt-1 rounded-full border border-white bg-slate-700 px-1.5 text-[10px] font-semibold leading-4 text-white shadow">
                        +{extra}
                      </span>
                    )}
                  </div>
                )}
              </AdvancedMarker>
            );
          })}

          {selectedGroup && !isSmallScreen && (
            <InfoWindow
              position={{ lat: selectedGroup.lat, lng: selectedGroup.lng }}
              onCloseClick={() => setSelectedKey(null)}
              minWidth={250}
            >
              <div className="min-w-[250px] p-1">
                {selectedGroup.devices.length === 1 ? (
                  <h3 className="font-bold mb-2 text-base text-black">
                    {selectedGroup.devices[0].name}
                  </h3>
                ) : null}
                <p className="text-gray-500 text-sm mb-1">
                  {selectedGroup.devices[0].location.address}
                </p>
                <p className="text-gray-500 text-sm mb-3">
                  {selectedGroup.devices[0].location.city}
                </p>

                <LocationDevices
                  group={selectedGroup}
                  onDetails={openDetails}
                  nameClassName="text-black"
                />
              </div>
            </InfoWindow>
          )}
        </Map>
      </APIProvider>

      <Sheet
        open={isSmallScreen && selectedGroup !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedKey(null);
        }}
      >
        <SheetContent
          side="bottom"
          closeLabel="Cerrar"
          className="max-h-[70vh] overflow-y-auto rounded-t-xl"
        >
          {selectedGroup && (
            <>
              <SheetHeader className="pr-12">
                <SheetTitle>
                  {selectedGroup.devices.length === 1
                    ? selectedGroup.devices[0].name
                    : selectedGroup.devices[0].location.address}
                </SheetTitle>
                <SheetDescription>
                  {selectedGroup.devices.length === 1
                    ? `${selectedGroup.devices[0].location.address}, ${selectedGroup.devices[0].location.city}`
                    : selectedGroup.devices[0].location.city}
                </SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-6">
                <LocationDevices
                  group={selectedGroup}
                  onDetails={openDetails}
                  buttonClassName="min-h-11"
                />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
