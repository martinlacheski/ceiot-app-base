/* eslint-disable @typescript-eslint/no-explicit-any */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getBestPlaceAddress,
  normalizePlaceSelection,
} from "@/lib/google-place-address";
import { Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useMapsLibrary } from "@vis.gl/react-google-maps";

interface GooglePlaceAutocompleteProps {
  onPlaceSelect: (place: any) => void | Promise<void>;
  placeholder?: string;
  initialValue?: string;
}

export function GooglePlaceAutocomplete({
  onPlaceSelect,
  placeholder = "Buscar en Google Maps",
  initialValue = "",
}: GooglePlaceAutocompleteProps) {
  const places = useMapsLibrary("places");
  const [predictions, setPredictions] = useState<
    google.maps.places.AutocompletePrediction[]
  >([]);
  const [inputValue, setInputValue] = useState(initialValue);
  const [isOpen, setIsOpen] = useState(false);
  const [sessionToken, setSessionToken] =
    useState<google.maps.places.AutocompleteSessionToken | null>(null);

  const handleInputChange = async (value: string) => {
    setInputValue(value);

    let currentToken = sessionToken;
    if (places && !currentToken) {
      currentToken = new places.AutocompleteSessionToken();
      setSessionToken(currentToken);
    }

    if (!value.trim()) {
      setPredictions([]);
      setIsOpen(false);
      return;
    }

    if (!places || !currentToken) return;

    try {
      const suggestionClass = (places as any).AutocompleteSuggestion;

      if (
        suggestionClass &&
        typeof suggestionClass.fetchAutocompleteSuggestions === "function"
      ) {
        const request = {
          input: value,
          sessionToken: currentToken,
          language: "es",
          region: "AR",
        };
        const { suggestions } =
          await suggestionClass.fetchAutocompleteSuggestions(request);

        setPredictions(
          suggestions.map((suggestion: any) => ({
            place_id: suggestion.placePrediction?.placeId,
            description: suggestion.placePrediction?.text?.text,
            structured_formatting: {
              main_text:
                suggestion.placePrediction?.mainText?.text ||
                suggestion.placePrediction?.text?.text,
              secondary_text:
                suggestion.placePrediction?.secondaryText?.text || "",
            },
          })),
        );
        setIsOpen(true);
        return;
      }

      const service = new places.AutocompleteService();
      const request: google.maps.places.AutocompletionRequest = {
        input: value,
        sessionToken: currentToken,
        language: "es",
        region: "AR",
      };

      service.getPlacePredictions(request, (results) => {
        if (results) {
          setPredictions(results);
          setIsOpen(true);
          return;
        }

        setPredictions([]);
        setIsOpen(false);
      });
    } catch (error) {
      toast.error("Error al buscar lugar. Error: " + error);
    }
  };

  const handlePredictionSelect = async (
    prediction: google.maps.places.AutocompletePrediction,
  ) => {
    setInputValue(prediction.description);
    setPredictions([]);
    setIsOpen(false);

    if (!places || !sessionToken) return;

    try {
      const Place = (google.maps.places as any).Place;
      const place = new Place({
        id: prediction.place_id,
        requestedLanguage: "es",
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

      const bestAddress = getBestPlaceAddress(place);
      const normalizedPlace = normalizePlaceSelection(place, bestAddress);

      await onPlaceSelect(normalizedPlace ?? place);
      setSessionToken(new places.AutocompleteSessionToken());
    } catch (error) {
      toast.error("Falló al obtener los detalles del lugar, error: " + error);
    }
  };

  return (
    <div className="relative w-full">
      {isOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
      )}
      <div className="flex w-full items-center bg-popover text-popover-foreground rounded-sm shadow-md relative z-50">
        <Input
          placeholder={placeholder}
          className="border-none rounded-none focus-visible:ring-0 h-10 flex-1 shadow-none"
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
        />
        <Button
          type="button"
          variant="ghost"
          className="rounded-none h-10 w-10 p-0 hover:bg-transparent"
        >
          <Search className="h-4 w-4 text-muted-foreground" />
        </Button>
      </div>

      {isOpen && predictions.length > 0 && (
        <ul className="absolute z-50 w-full bg-popover text-popover-foreground mt-1 shadow-lg rounded-sm max-h-60 overflow-auto py-1">
          {predictions.map((prediction) => (
            <li
              key={prediction.place_id}
              className="px-4 py-2 hover:bg-accent cursor-pointer text-sm flex items-center gap-2"
              onClick={() => handlePredictionSelect(prediction)}
            >
              <div className="w-4 h-4 text-muted-foreground">
                <Search className="w-3 h-3" />
              </div>
              <div className="flex flex-col">
                <span className="font-medium text-foreground">
                  {prediction.structured_formatting.main_text}
                </span>
                <span className="text-xs text-muted-foreground">
                  {prediction.structured_formatting.secondary_text}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
