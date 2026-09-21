/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  getCitiesAction,
  getCountriesAction,
  getStatesAction,
  getCityAction,
} from "@/admin/actions/location.actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { MapPin, Pencil, Loader2 } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SearchableSelect } from "./SearchableSelect";

interface CitySelectorProps {
  value?: string;
  onChange: (cityId: string) => void;
  disabled?: boolean;
}

export function CitySelector({ value, onChange, disabled }: CitySelectorProps) {
  const [open, setOpen] = useState(false);

  // Fetch full city details if value is present to display hierarchy
  // and to populate the form initial state
  const { data: cityDetails, isLoading: isLoadingDetails } = useQuery({
    queryKey: ["city", value],
    queryFn: () => getCityAction(value!),
    enabled: !!value,
  });

  // Determine display text
  let displayText = "Seleccionar Ciudad";
  if (value && cityDetails) {
    const countryName = cityDetails.state?.country?.name;
    const stateName = cityDetails.state?.name;
    const cityName = cityDetails.name;

    if (countryName && stateName && cityName) {
      displayText = `${countryName} - ${stateName} - ${cityName}`;
    } else {
      displayText = cityName || "Ciudad Seleccionada";
    }
  } else if (value && isLoadingDetails) {
    displayText = "Cargando...";
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-between text-left font-normal"
          disabled={disabled}
        >
          <div className="flex items-center truncate">
            <MapPin className="mr-2 h-4 w-4 flex-shrink-0" />
            <span className="truncate">{displayText}</span>
          </div>
          <Pencil className="ml-2 h-4 w-4 flex-shrink-0 opacity-50" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Seleccionar Ubicación</DialogTitle>
        </DialogHeader>

        {/* Render Form only when open to reset state via key, or conditionally if loading */}
        {value && isLoadingDetails ? (
          <div className="flex justify-center p-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <CitySelectorForm
            key={open ? "open" : "closed"} // Force re-mount on open to reset state
            initialCityId={value}
            initialDetails={cityDetails}
            onSave={(cityId) => {
              onChange(cityId);
              setOpen(false);
            }}
            onCancel={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CitySelectorForm({
  initialCityId,
  initialDetails,
  onSave,
  onCancel,
}: {
  initialCityId?: string;
  initialDetails?: any;
  onSave: (id: string) => void;
  onCancel: () => void;
}) {
  const [selectedCountry, setSelectedCountry] = useState<string>(
    initialDetails?.state?.country?.id || ""
  );
  const [selectedState, setSelectedState] = useState<string>(
    initialDetails?.state?.id || ""
  );
  const [selectedCity, setSelectedCity] = useState<string>(initialCityId || "");

  // Queries
  const { data: countriesData } = useQuery({
    queryKey: ["countries"],
    queryFn: () => getCountriesAction({}),
  });
  const countries = countriesData?.items || [];

  const { data: statesData } = useQuery({
    queryKey: ["states", selectedCountry],
    queryFn: () => getStatesAction({ countryId: selectedCountry }),
    enabled: !!selectedCountry,
  });
  const states = statesData?.items || [];

  const { data: citiesData } = useQuery({
    queryKey: ["cities", selectedState],
    queryFn: () => getCitiesAction({ stateId: selectedState }),
    enabled: !!selectedState,
  });
  const cities = citiesData?.items || [];

  // Handlers
  const handleCountryChange = (countryId: string | undefined) => {
    setSelectedCountry(countryId || "");
    setSelectedState("");
    setSelectedCity("");
  };

  const handleStateChange = (stateId: string | undefined) => {
    setSelectedState(stateId || "");
    setSelectedCity("");
  };

  const handleCityChange = (cityId: string | undefined) => {
    setSelectedCity(cityId || "");
  };

  return (
    <>
      <div className="grid gap-4 py-4">
        <div className="grid gap-2">
          <Label>País</Label>
          <SearchableSelect
            options={countries.map((c: any) => ({
              value: c.id,
              label: c.name,
            }))}
            value={selectedCountry}
            onChange={handleCountryChange}
            placeholder="Seleccione un país"
          />
        </div>
        <div className="grid gap-2">
          <Label>Provincia / Estado</Label>
          <SearchableSelect
            options={states.map((s: any) => ({ value: s.id, label: s.name }))}
            value={selectedState}
            onChange={handleStateChange}
            disabled={!selectedCountry}
            placeholder="Seleccione una provincia"
          />
        </div>
        <div className="grid gap-2">
          <Label>Ciudad</Label>
          <SearchableSelect
            options={cities.map((c: any) => ({ value: c.id, label: c.name }))}
            value={selectedCity}
            onChange={handleCityChange}
            disabled={!selectedState}
            placeholder="Seleccione una ciudad"
          />
        </div>
      </div>
      <DialogFooter className="flex w-full justify-end gap-2 sm:justify-end">
        <Button variant="outline" onClick={onCancel}>
          Volver
        </Button>
        <Button onClick={() => onSave(selectedCity)} disabled={!selectedCity}>
          Seleccionar
        </Button>
      </DialogFooter>
    </>
  );
}
