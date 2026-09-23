/* eslint-disable @typescript-eslint/no-explicit-any */
import { resolveLocationAction } from "@/admin/actions/location.actions";
import { GooglePlaceAutocomplete } from "@/components/custom/GooglePlaceAutocomplete";
import {
  getBestPlaceAddress,
  hasPrecisePlaceStreetAddress,
} from "@/lib/google-place-address";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  AdvancedMarker,
  APIProvider,
  ControlPosition,
  Map,
  MapControl,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import { MapPin } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export interface AddressMapDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialAddress: string;
  initialCityId: string;
  onConfirm: (value: { address: string; cityId: string }) => void;
}

interface CoordinateValue {
  lat: number;
  lng: number;
}

interface ResolvedLocationValue {
  address: string;
  cityId: string;
  markerPosition: CoordinateValue | null;
}

const DEFAULT_CENTER: CoordinateValue = { lat: -38.416097, lng: -63.616672 };

function parseCoordinates(value: string): CoordinateValue | null {
  const match = value.match(/([-+]?\d{1,2}\.\d+),\s*([-+]?\d{1,3}\.\d+)/);

  if (!match) {
    return null;
  }

  return {
    lat: Number.parseFloat(match[1]),
    lng: Number.parseFloat(match[2]),
  };
}

function getLocationCoordinates(location: unknown): CoordinateValue | null {
  if (!location || typeof location !== "object") {
    return null;
  }

  const candidate = location as {
    lat?: number | (() => number);
    lng?: number | (() => number);
  };

  if (candidate.lat === undefined || candidate.lng === undefined) {
    return null;
  }

  return {
    lat: typeof candidate.lat === "function" ? candidate.lat() : candidate.lat,
    lng: typeof candidate.lng === "function" ? candidate.lng() : candidate.lng,
  };
}

function buildInitialState(
  initialAddress: string,
  initialCityId: string,
): ResolvedLocationValue {
  const markerPosition = parseCoordinates(initialAddress);

  return {
    address: initialAddress,
    cityId: initialCityId,
    markerPosition,
  };
}

function AddressMapDialogContent({
  initialAddress,
  initialCityId,
  onConfirm,
  onOpenChange,
}: Omit<AddressMapDialogProps, "open">) {
  const placesLib = useMapsLibrary("places");
  const [selection, setSelection] = useState<ResolvedLocationValue>(() =>
    buildInitialState(initialAddress, initialCityId),
  );
  const [cameraCenter, setCameraCenter] = useState<CoordinateValue | null>(
    selection.markerPosition,
  );
  const [zoom, setZoom] = useState(selection.markerPosition ? 15 : 4);
  const [isResolving, setIsResolving] = useState(false);

  const handleResolvedSelection = async (
    inputValue: string,
    updateAddressField = true,
    fallbackAddress = "",
  ) => {
    if (!inputValue) {
      return;
    }

    setIsResolving(true);

    try {
      const data = await resolveLocationAction(inputValue);
      const nextMarker =
        data.latitude && data.longitude
          ? { lat: data.latitude, lng: data.longitude }
          : null;

      setSelection((current) => ({
        address:
          updateAddressField && data.address
            ? data.address
            : fallbackAddress || current.address,
        cityId: data.city_id || current.cityId,
        markerPosition: nextMarker || current.markerPosition,
      }));

      if (nextMarker) {
        setCameraCenter(nextMarker);
        setZoom(15);
      }
    } catch (error: any) {
      toast.error(
        error.response?.data?.detail ||
          error.message ||
          "No se pudo resolver la ubicación",
      );
    } finally {
      setIsResolving(false);
    }
  };

  const handlePlaceSelect = async (place: any) => {
    const nextAddress = getBestPlaceAddress(place) || selection.address;
    const preservePlaceAddress = hasPrecisePlaceStreetAddress(place);
    const nextCoordinates = getLocationCoordinates(
      place?.location || place?.geometry?.location,
    );

    if (nextCoordinates) {
      setSelection((current) => ({
        ...current,
        address: nextAddress,
        markerPosition: nextCoordinates,
      }));
      setCameraCenter(nextCoordinates);
      setZoom(15);
      await handleResolvedSelection(
        `${nextCoordinates.lat},${nextCoordinates.lng}`,
        !preservePlaceAddress,
        nextAddress,
      );
      return;
    }

    if (nextAddress) {
      setSelection((current) => ({
        ...current,
        address: nextAddress,
      }));
      await handleResolvedSelection(
        nextAddress,
        !preservePlaceAddress,
        nextAddress,
      );
    }
  };

  const handleMapClick = async (event: any) => {
    if (event.detail?.placeId) {
      if (typeof event.detail.stop === "function") {
        event.detail.stop();
      }

      if (!placesLib) {
        return;
      }

      try {
        const Place = (placesLib as any).Place;
        const place = new Place({
          id: event.detail.placeId,
          requestedLanguage: "es",
        });

        await place.fetchFields({
          fields: ["addressComponents", "formattedAddress", "location"],
        });

        await handlePlaceSelect(place);
        return;
      } catch {
        toast.error("No se pudo obtener el lugar seleccionado");
        return;
      }
    }

    const coordinates = getLocationCoordinates(event.detail?.latLng);

    if (!coordinates) {
      return;
    }

    setSelection((current) => ({
      ...current,
      markerPosition: coordinates,
    }));
    setCameraCenter(coordinates);
    setZoom(15);
    await handleResolvedSelection(`${coordinates.lat},${coordinates.lng}`);
  };

  const handleConfirm = () => {
    onConfirm({
      address: selection.address,
      cityId: selection.cityId,
    });
    onOpenChange(false);
  };

  return (
    <DialogContent className="max-w-5xl p-0 [@media(max-height:740px)]:!max-h-[94dvh]">
      <DialogHeader className="px-6 pt-6 pb-0">
        <DialogTitle>Ingresar dirección</DialogTitle>
        <DialogDescription>
          Buscá la dirección y ajustala en el mapa antes de confirmar.
        </DialogDescription>
      </DialogHeader>

      <div className="px-6">
        <div className="overflow-hidden rounded-lg border">
          <Map
            className="h-[45dvh] max-h-[420px] sm:h-[65dvh] sm:max-h-[520px] [@media(max-height:740px)]:h-[57dvh] [@media(max-height:740px)]:max-h-[440px]"
            style={{ width: "100%" }}
            defaultCenter={DEFAULT_CENTER}
            center={cameraCenter || undefined}
            zoom={zoom}
            onCameraChanged={(event) => setCameraCenter(event.detail.center)}
            onZoomChanged={(event) => setZoom(event.detail.zoom)}
            gestureHandling="greedy"
            disableDefaultUI={false}
            mapTypeControl={false}
            streetViewControl={false}
            onClick={handleMapClick}
          mapId="IOT_MAP_ID"
          >
            <MapControl position={ControlPosition.TOP_CENTER}>
              <div className="mt-4 w-[92%] max-w-[26rem] px-3 sm:w-[min(92vw,34rem)] sm:max-w-[34rem] sm:px-0">
                <GooglePlaceAutocomplete
                  key={selection.address || selection.cityId || "address-map-search"}
                  onPlaceSelect={handlePlaceSelect}
                  placeholder="Buscar dirección en Google Maps"
                  initialValue={selection.address}
                />
              </div>
            </MapControl>

            {selection.markerPosition && (
              <AdvancedMarker
                position={selection.markerPosition}
                title="Ubicación seleccionada"
              />
            )}
          </Map>
        </div>

        <div className="mt-4 rounded-lg border bg-muted/60 p-4">
          <div className="hidden items-center gap-2 text-sm font-medium text-foreground sm:flex [@media(max-height:740px)]:!hidden">
            <MapPin className="h-4 w-4" />
            Selección actual
            {isResolving ? <Badge variant="secondary">Resolviendo...</Badge> : null}
          </div>

          <Separator className="my-3 hidden sm:block [@media(max-height:740px)]:!hidden" />

          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Dirección
              {isResolving ? (
                <Badge
                  variant="secondary"
                  className="ml-2 normal-case sm:hidden [@media(max-height:740px)]:!inline-flex"
                >
                  Resolviendo...
                </Badge>
              ) : null}
            </p>
            <p className="text-sm text-foreground">
              {selection.address || "Seleccioná una ubicación válida"}
            </p>
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 rounded-b-lg bg-background px-6 pb-4 pt-2 flex gap-2 sm:justify-end">
        <Button type="button" variant="outline" className="flex-1 sm:flex-none" onClick={() => onOpenChange(false)}>
          Cancelar
        </Button>
        <Button
          type="button"
          className="flex-1 sm:flex-none"
          onClick={handleConfirm}
          disabled={!selection.cityId || !selection.address || isResolving}
        >
          Confirmar dirección
        </Button>
      </div>
    </DialogContent>
  );
}

export function AddressMapDialog(props: AddressMapDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? (
        <APIProvider
          apiKey={import.meta.env.VITE_GCP_API_KEY}
          language="es"
          region="AR"
        >
          <AddressMapDialogContent
            initialAddress={props.initialAddress}
            initialCityId={props.initialCityId}
            onConfirm={props.onConfirm}
            onOpenChange={props.onOpenChange}
          />
        </APIProvider>
      ) : null}
    </Dialog>
  );
}
