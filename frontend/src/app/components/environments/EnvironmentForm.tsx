/* eslint-disable @typescript-eslint/no-explicit-any */
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { SmartPhoneInput } from "@/components/custom/SmartPhoneInput";
import { SearchableSelect } from "@/components/custom/SearchableSelect";
import {
  FULL_PAGE_FORM_ACTION_BUTTON_CLASS,
  FULL_PAGE_FORM_ACTIONS_CLASS,
  FULL_PAGE_FORM_BACK_LABEL,
  FULL_PAGE_FORM_SAVE_LABEL,
} from "@/components/custom/fullPageFormActions";
import { useQuery } from "@tanstack/react-query";
import { environmentService } from "@/app/services/environment.service";
import { Loader2, MapPin, Locate } from "lucide-react";
import type { EnvironmentType } from "@/app/types/environment.types";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import { useState, useCallback } from "react";
import type { ReactNode } from "react";
import { resolveLocationAction } from "@/admin/actions/location.actions";
import { ensureEnvironmentTypeAction } from "@/admin/actions/environment.actions";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useConfirmStore } from "@/store/confirm.store";
import { GooglePlaceAutocomplete } from "@/components/custom/GooglePlaceAutocomplete";
import {
  getBestPlaceAddress,
  hasPrecisePlaceStreetAddress,
} from "@/lib/google-place-address";

const PLACE_TYPE_TRANSLATIONS: Record<string, string> = {
  street_address: "Dirección",
  route: "Calle",
  intersection: "Intersección",
  political: "Zona política",
  country: "País",
  administrative_area_level_1: "Provincia",
  administrative_area_level_2: "Departamento",
  administrative_area_level_3: "Municipio",
  locality: "Localidad",
  sublocality: "Barrio",
  neighborhood: "Barrio",
  premise: "Edificio",
  subpremise: "Unidad",
  postal_code: "Código postal",
  natural_feature: "Elemento natural",
  airport: "Aeropuerto",
  park: "Parque",
  point_of_interest: "Punto de interés",
  establishment: "Establecimiento",
  geocode: "Dirección",
  bus_station: "Terminal de ómnibus",
  train_station: "Estación de tren",
  transit_station: "Estación de transporte",
  restaurant: "Restaurante",
  food: "Gastronomía",
  store: "Tienda",
  lodging: "Alojamiento",
  health: "Salud",
  school: "Escuela",
  hospital: "Hospital",
  pharmacy: "Farmacia",
  bank: "Banco",
  atm: "Cajero automático",
  gas_station: "Estación de servicio",
  parking: "Estacionamiento",
  shopping_mall: "Centro comercial",
  supermarket: "Supermercado",
  church: "Iglesia",
  university: "Universidad",
  stadium: "Estadio",
  gym: "Gimnasio",
  night_club: "Boliche",
  bar: "Bar",
  cafe: "Cafetería",
  museum: "Museo",
  library: "Biblioteca",
  movie_theater: "Cine",
  hotel: "Hotel",
};

function translatePlaceType(type: string): string {
  return PLACE_TYPE_TRANSLATIONS[type] ?? type
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const getEnvironmentSchema = () =>
  z.object({
    name: z.string().min(3, "El nombre debe tener al menos 3 caracteres"),
    typeId: z.string().min(1, "El tipo de establecimiento es requerido"),
    cityId: z.string().min(1, "La ciudad es requerida"),
    address: z.string().min(1, "La dirección es requerida"),
    location: z
      .string()
      .min(1, "La ubicación requerida (ej. Nombre del Edificio o Link)"),
    description: z.string().optional(),
    phone: z.string().optional(),
    isActive: z.boolean().default(true),
  });

export type EnvironmentFormValues = z.infer<
  ReturnType<typeof getEnvironmentSchema>
>;

interface EnvironmentFormProps {
  defaultValues?: Partial<EnvironmentFormValues>;
  onSubmit: (values: EnvironmentFormValues) => Promise<void>;
  isSubmitting?: boolean;
  onCancel?: () => void;
  submitLabel?: string;
  cancelLabel?: string;
  afterDescriptionContent?: ReactNode;
}

const MAP_SEARCH_WIDTH_CLASS =
  "w-[92%] max-w-[26rem] sm:w-[min(92vw,34rem)] sm:max-w-[34rem] xl:w-[min(70vw,24rem)] xl:max-w-[24rem] 2xl:w-[min(92vw,34rem)] 2xl:max-w-[34rem]";
const READONLY_INPUT_CLASS =
  "cursor-not-allowed bg-muted/60 text-muted-foreground";

// Internal component containing the main form logic
function EnvironmentFormContent({
  defaultValues,
  onSubmit,
  isSubmitting = false,
  onCancel,
  submitLabel = FULL_PAGE_FORM_SAVE_LABEL,
  cancelLabel = FULL_PAGE_FORM_BACK_LABEL,
  afterDescriptionContent,
}: EnvironmentFormProps) {
  const placesLib = useMapsLibrary("places");
  const form = useForm<EnvironmentFormValues>({
    resolver: zodResolver(getEnvironmentSchema()) as any,
    defaultValues: {
      name: defaultValues?.name || "",
      typeId: defaultValues?.typeId || "",
      cityId: defaultValues?.cityId || "",
      address: defaultValues?.address || "",
      location: defaultValues?.location || "",
      description: defaultValues?.description || "",
      phone: defaultValues?.phone || "",
      isActive: defaultValues?.isActive ?? true,
    },
  });

  // Google Maps State - Lazy Init
  const [zoom, setZoom] = useState<number>(() => {
    return defaultValues?.location ? 15 : 4;
  });

  const [cameraCenter, setCameraCenter] = useState<{
    lat: number;
    lng: number;
  } | null>(() => {
    if (defaultValues?.location) {
      const match = defaultValues.location.match(
        /([-+]?\d{1,2}\.\d+),\s*([-+]?\d{1,3}\.\d+)/,
      );
      if (match) {
        const lat = parseFloat(match[1]);
        const lng = parseFloat(match[2]);
        return { lat, lng };
      }
    }
    return null;
  });

  const [markerPosition, setMarkerPosition] = useState<{
    lat: number;
    lng: number;
  } | null>(() => {
    if (defaultValues?.location) {
      const match = defaultValues.location.match(
        /([-+]?\d{1,2}\.\d+),\s*([-+]?\d{1,3}\.\d+)/,
      );
      if (match) {
        const lat = parseFloat(match[1]);
        const lng = parseFloat(match[2]);
        return { lat, lng };
      }
    }
    return null;
  });

  // Fetch Environment Types
  const { data: typesData, isLoading: isLoadingTypes } = useQuery({
    queryKey: ["environmentTypes"],
    queryFn: () => environmentService.getTypes(),
  });

  const queryClient = useQueryClient();

  const environmentTypes = typesData?.items || [];
  const { openConfirm } = useConfirmStore();

  const handleResolveLocation = useCallback(
    async (inputValue: string, updateAddressField = true) => {
      if (!inputValue) return;
      try {
        const data = await resolveLocationAction(inputValue);

        if (data.latitude && data.longitude) {
          const newPos = { lat: data.latitude, lng: data.longitude };
          setCameraCenter(newPos);
          setMarkerPosition(newPos);
          setZoom(15); // Zoom in when resolved
          // Also update the location (coords) field if we resolved from an address string
          form.setValue("location", `${data.latitude},${data.longitude}`, {
            shouldValidate: true,
          });
        }

        if (data.city_id) {
          form.setValue("cityId", data.city_id, { shouldValidate: true });
        }

        if (data.address && updateAddressField) {
          form.setValue("address", data.address, { shouldValidate: true });
        }

        if (updateAddressField) {
          toast.success("Ubicación encontrada");
        }
      } catch (error: any) {
        toast.error(
          "No se pudo resolver la ubicación, error: " + error.message,
        );
      }
    },
    [form],
  );

  // Parse location input (link or coords)
  const handleLocationInputChange = (value: string) => {
    form.setValue("location", value, { shouldValidate: true });

    // Try to parse coordinates locally for speed
    let match = value.match(/([-+]?\d{1,2}\.\d+),\s*([-+]?\d{1,3}\.\d+)/);

    // If not direct coords, try to parse Google Maps Link locally
    if (!match && value.includes("google.com/maps")) {
      match = value.match(/@([-+]?\d+\.\d+),([-+]?\d+\.\d+)/);
    }

    // Also try to parse Google Geocode API URLs (which the user might paste)
    // Example: https://maps.googleapis.com/maps/api/geocode/json?latlng=-26.5695,-54.7536&key=...
    if (!match && value.includes("latlng=")) {
      match = value.match(/latlng=([-+]?\d+\.\d+),([-+]?\d+\.\d+)/);
    }

    if (match) {
      const lat = parseFloat(match[1]);
      const lng = parseFloat(match[2]);
      const newPos = { lat, lng };
      setCameraCenter(newPos);
      setMarkerPosition(newPos);
      setZoom(15);
      handleResolveLocation(`${lat},${lng}`, true);
    } else if (
      value.length > 10 &&
      (value.includes("http") || value.includes("google.com"))
    ) {
      // If it looks like a URL but we couldn't parse it locally, let the backend try
      // We debounce this slightly effectively by relying on the user to stop typing validly?
      // Or just let it fly. The backend can handle it.
      // Actually, for a pasted URL, this fires once.
      handleResolveLocation(value, true);
    }
  };

  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast.warning("La geolocalización no es soportada por este navegador");
      return;
    }

    toast.info("Obteniendo ubicación...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const newPos = { lat, lng };
        setCameraCenter(newPos);
        setMarkerPosition(newPos);
        setZoom(15);
        const coordString = `${lat},${lng}`;
        form.setValue("location", coordString, { shouldValidate: true });
        handleResolveLocation(coordString, true);
        toast.success("Ubicación actual obtenida");
      },
      (error) => {
        let errorMessage = "No se pudo obtener la ubicación.";
        if (error.code === 1) {
          // PERMISSION_DENIED
          errorMessage =
            "Permiso de ubicación denegado. Por favor, habilite el acceso a la ubicación en el navegador y vuelva a intentarlo.";
        } else if (error.code === 2) {
          // POSITION_UNAVAILABLE
          errorMessage = "La información de ubicación no está disponible.";
        } else if (error.code === 3) {
          // TIMEOUT
          errorMessage = "Se agotó el tiempo para obtener la ubicación.";
        }

        toast.error(errorMessage);
      },
    );
  };

  const openLocationInNewTab = () => {
    const location = form.getValues("location");
    if (!location) return;

    let targetUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
    try {
      const parsedUrl = new URL(location);
      const isTrustedGoogleMapsHost =
        parsedUrl.protocol === "https:" &&
        (parsedUrl.hostname === "goo.gl" ||
          parsedUrl.hostname === "maps.app.goo.gl" ||
          parsedUrl.hostname === "google.com" ||
          parsedUrl.hostname.endsWith(".google.com"));
      if (isTrustedGoogleMapsHost) targetUrl = parsedUrl.toString();
    } catch {
      // Coordinates and free text are opened as a Google Maps search.
    }

    window.open(targetUrl, "_blank", "noopener,noreferrer");
  };

  // Use useCallback for handlePlaceSelect as well to be safe, though not strictly required if not passed as dependency
  const handlePlaceSelect = useCallback(
    async (place: any) => {
      if (!place) return;

      // Clear existing data to ensure we don't keep stale data
      // We don't necessarily want to validate immediately on clear, but we could.
      // Let's just set them.
      form.setValue("name", "");
      form.setValue("phone", "");
      form.setValue("typeId", "");
      // Description is purposely left alone or user can clear if needed.
      // Instructions say: "Si el lugar no posee datos...". Clearing ensures this.

      // New API: place.location is LatLng
      // Legacy API: place.geometry.location is LatLng
      // We are using New API now, so place.location should check.

      const location = place.location || place.geometry?.location;

      if (location) {
        const lat =
          typeof location.lat === "function" ? location.lat() : location.lat;
        const lng =
          typeof location.lng === "function" ? location.lng() : location.lng;
        const coordString = `${lat},${lng}`;
        const preservePlaceAddress = hasPrecisePlaceStreetAddress(place);

        // Update Map
        setCameraCenter({ lat, lng });
        setMarkerPosition({ lat, lng });
        setZoom(15);

        const formattedAddress = getBestPlaceAddress(place);
        if (formattedAddress) {
          form.setValue("address", formattedAddress, { shouldValidate: true });
        }

        // Update Form Location Field
        form.setValue("location", coordString, { shouldValidate: true });

        // Auto-fill Name
        // New API: displayName | Legacy: name
        const name = place.displayName || place.name;
        if (name) {
          form.setValue("name", name, { shouldValidate: true });
        }

        // Auto-fill Phone
        // New API: internationalPhoneNumber | Legacy: international_phone_number
        const phoneRaw =
          place.internationalPhoneNumber || place.international_phone_number;
        if (phoneRaw) {
          // Simple cleanup: remove spaces, dashes, ensure + prefix
          const phone = phoneRaw.replace(/[\s-]/g, "");
          form.setValue("phone", phone, { shouldValidate: true });
        }

        // NEW API: primaryTypeDisplayName (Localized)
        let formattedType = place.primaryTypeDisplayName;

        if (!formattedType) {
          // Fallback to types array if primaryTypeDisplayName not available
          if (place.types && place.types.length > 0) {
            const ignoredTypes = [
              "point_of_interest",
              "establishment",
              "premise",
              "geocode",
              "political",
              "neighborhood",
              "locality",
              "street_address",
            ];
            const specificType = place.types.find(
              (t: string) => !ignoredTypes.includes(t),
            );
            const finalType = specificType || place.types[0];
            if (finalType) {
              formattedType = translatePlaceType(finalType);
            }
          }
        }

        if (formattedType) {
          // Capitalize first letter just in case
          formattedType =
            formattedType.charAt(0).toUpperCase() + formattedType.slice(1);

          try {
            const type = await ensureEnvironmentTypeAction(formattedType);
            if (type && type.id) {
              form.setValue("typeId", type.id, { shouldValidate: true });
              // Trigger re-fetch silently
              queryClient.invalidateQueries({ queryKey: ["environmentTypes"] });
            }
          } catch (error) {
            toast.error(
              "Falló al asegurar el tipo de ambiente, error: " + error,
            );
          }
        }

        // Resolve city/hierarchy from backend without overwriting exact Places address.
        handleResolveLocation(coordString, !preservePlaceAddress);
      }
    },
    [form, handleResolveLocation, queryClient],
  );

  const onMapClick = useCallback(
    async (e: any) => {
      // Check if user clicked on a POI (Place of Interest)
      // The event is a CustomEvent, detailing the native Google Maps event in e.detail
      if (e.detail && e.detail.placeId) {
        // Prevent the default Google Maps InfoWindow from opening
        if (typeof e.detail.stop === "function") {
          e.detail.stop();
        }

        if (!placesLib) {
          return;
        }

        try {
          // Fetch Place Details similar to Autocomplete
          // Use placesLib directly since we have the hook
          const Place = (placesLib as any).Place;
          const place = new Place({
            id: e.detail.placeId,
            requestedLanguage: "es", // Request Spanish explicitly
          });

          await place.fetchFields({
              fields: [
                "addressComponents",
                "displayName",
                "formattedAddress",
                "location",
              "types",
              "internationalPhoneNumber",
              "primaryTypeDisplayName",
            ],
          });

          // Reuse the handlePlaceSelect logic to populate form
          await handlePlaceSelect(place);
          return; // Stop here, don't execute generic logic
        } catch (error) {
          toast.error(
            "Falló al obtener los detalles del lugar, error: " + error,
          );
          // If fetching fails, we might want to fall through or just alert
        }
      }

      if (e.detail && e.detail.latLng) {
        // Clear existing data as this is a new arbitrary location
        form.setValue("name", "");
        form.setValue("phone", "");
        form.setValue("typeId", "");

        const lat = e.detail.latLng.lat; // These might be functions or properties depending on API version
        // Access safely
        const latVal = typeof lat === "function" ? lat() : lat;
        const lngVal =
          typeof e.detail.latLng.lng === "function"
            ? e.detail.latLng.lng()
            : e.detail.latLng.lng;

        const coordString = `${latVal},${lngVal}`;

        // Update visual immediately
        setMarkerPosition({ lat: latVal, lng: lngVal });

        // Update Input
        form.setValue("location", coordString, { shouldValidate: true });

        // Resolve backend data (City/Address)
        await handleResolveLocation(coordString, true);
      }
    },
    [form, handleResolveLocation, placesLib, handlePlaceSelect],
  );

  // Check Name availability
  const checkName = async () => {
    const name = form.getValues("name");
    if (name === defaultValues?.name) {
      form.clearErrors("name");
      return;
    }
    if (name && !form.getFieldState("name").invalid) {
      try {
        const result = await environmentService.checkAvailability({ name });
        if (!result.available) {
          form.setError("name", {
            type: "manual",
            message: result.message || "Este nombre ya no está disponible",
          });
        } else {
          form.clearErrors("name");
        }
      } catch (error) {
        // Find a way to handle error? Silent fail or console log
        console.error("Error checking name availability", error);
      }
    }
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) => {
          openConfirm(
            defaultValues && "id" in defaultValues
              ? "¿Está seguro que desea guardar los cambios?"
              : "¿Está seguro que desea crear este establecimiento?",
            async () => {
              await onSubmit(values);
            },
          );
        })}
        className="space-y-8"
      >
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] 2xl:grid-cols-[minmax(0,0.62fr)_minmax(0,1.38fr)]">
          {/* Left Column: Inputs */}
          <div className="min-w-0 space-y-4 xl:max-w-[50rem] 2xl:max-w-[56rem]">
            <input type="hidden" {...form.register("cityId")} />

            {/* Name and Active */}
            <div className="flex min-w-0 flex-col-reverse gap-3 sm:flex-row sm:flex-nowrap sm:items-start xl:gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="min-w-0 flex-1">
                    <FormLabel>Nombre del Establecimiento</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Ingrese el nombre del establecimiento"
                        {...field}
                        onChange={(e) => {
                          field.onChange(e);
                          if (form.getFieldState("name").invalid) {
                            form.clearErrors("name");
                          }
                        }}
                        onBlur={() => {
                          field.onBlur();
                          checkName();
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="shrink-0">
                    <FormLabel className="flex justify-end sm:justify-start">
                      Estado
                    </FormLabel>
                    <div className="flex h-10 items-center justify-end space-x-2 sm:justify-start">
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <span className="text-sm font-medium">
                        {field.value ? "Activo" : "Inactivo"}
                      </span>
                    </div>
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="typeId"
              render={({ field }) => (
                <FormItem className="min-w-0">
                  <FormLabel>Tipo de Establecimiento</FormLabel>
                  <FormControl>
                    <SearchableSelect
                      options={environmentTypes.map((t: EnvironmentType) => ({
                        label: t.name,
                        value: t.id,
                      }))}
                      value={field.value}
                      onChange={field.onChange}
                      placeholder={
                        isLoadingTypes ? "Cargando..." : "Seleccione tipo"
                      }
                      disabled={isLoadingTypes}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem className="min-w-0">
                  <FormLabel>Teléfono de Contacto</FormLabel>
                  <FormControl>
                    <SmartPhoneInput
                      value={field.value || ""}
                      onChange={field.onChange}
                      placeholder="Ingrese el teléfono de contacto"
                      countryButtonClassName="w-[130px] md:w-[140px]"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem className="min-w-0">
                  <FormLabel>Dirección</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ingrese la dirección"
                      {...field}
                      readOnly
                      aria-readonly="true"
                      className={READONLY_INPUT_CLASS}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="location"
              render={({ field }) => (
                <FormItem className="min-w-0">
                  <FormLabel>Ubicación</FormLabel>
                  <FormControl>
                    <div className="flex min-w-0 flex-wrap gap-2 sm:flex-nowrap">
                      <div className="min-w-0 flex-1">
                        <Input
                          placeholder="Coordenadas o Link de Google Maps"
                          {...field}
                          onChange={(e) =>
                            handleLocationInputChange(e.target.value)
                          }
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="shrink-0"
                        title="Abrir en Google Maps"
                        onClick={openLocationInNewTab}
                        disabled={!field.value}
                      >
                        <MapPin className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="shrink-0"
                        title="Obtener Mi Ubicación"
                        onClick={handleGetCurrentLocation}
                      >
                        <Locate className="h-4 w-4" />
                      </Button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem className="min-w-0">
                  <FormLabel>Descripción</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ingrese la descripción del establecimiento"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

          </div>

          {/* Right Column: Map */}
          <div data-testid="environment-map-container" className="relative isolate h-[560px] w-full overflow-hidden rounded-lg border xl:h-auto xl:min-h-[24rem] xl:min-w-0">
            <Map
              style={{ width: "100%", height: "100%" }}
              defaultCenter={{ lat: -38.416097, lng: -63.616672 }}
               center={cameraCenter || undefined}
               zoom={zoom}
               onCameraChanged={(ev) => setCameraCenter(ev.detail.center)}
               onZoomChanged={(ev) => setZoom(ev.detail.zoom)}
              gestureHandling={"greedy"}
              disableDefaultUI={false}
              mapTypeControl={false}
              streetViewControl={false}
              onClick={onMapClick}
                mapId="IOT_MAP_ID"
            >
              {markerPosition && (
                <AdvancedMarker
                  position={markerPosition}
                  title="Ubicación seleccionada"
                />
              )}
            </Map>

            <div className="pointer-events-none absolute inset-x-0 top-0 z-[999] flex justify-center px-3 pt-4 sm:px-0 [transform:translateZ(0)] [will-change:transform]">
              <div className={`pointer-events-auto ${MAP_SEARCH_WIDTH_CLASS}`}>
                <GooglePlaceAutocomplete onPlaceSelect={handlePlaceSelect} />
              </div>
            </div>
          </div>
        </div>

        <Separator />

        {/* Action Buttons */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          {afterDescriptionContent && (
            <div className="w-full sm:w-auto">{afterDescriptionContent}</div>
          )}
          <div className={`${FULL_PAGE_FORM_ACTIONS_CLASS} sm:ml-auto`}>
            {onCancel && (
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={isSubmitting}
                className={FULL_PAGE_FORM_ACTION_BUTTON_CLASS}
              >
                {cancelLabel}
              </Button>
            )}
            <Button
              type="submit"
              disabled={isSubmitting}
              className={FULL_PAGE_FORM_ACTION_BUTTON_CLASS}
            >
              {isSubmitting && (
                <Loader2 aria-hidden="true" data-icon="inline-start" className="animate-spin" />
              )}
              {submitLabel}
            </Button>
          </div>
        </div>
      </form>
    </Form>
  );
}

// Export Wrapper
export function EnvironmentForm(props: EnvironmentFormProps) {
  return (
    <APIProvider
      apiKey={import.meta.env.VITE_GCP_API_KEY}
      language="es"
      region="AR"
    >
      <EnvironmentFormContent {...props} />
    </APIProvider>
  );
}
