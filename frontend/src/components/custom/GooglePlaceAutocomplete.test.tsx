import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GooglePlaceAutocomplete } from "./GooglePlaceAutocomplete";

const { placesLibRef } = vi.hoisted(() => ({
  placesLibRef: { current: {} as Record<string, unknown> },
}));

vi.mock("@vis.gl/react-google-maps", () => ({
  useMapsLibrary: () => placesLibRef.current,
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

class FakeSessionToken {}

describe("GooglePlaceAutocomplete", () => {
  const fetchAutocompleteSuggestions = vi.fn();
  const getPlacePredictions = vi.fn();

  beforeEach(() => {
    fetchAutocompleteSuggestions.mockReset();
    fetchAutocompleteSuggestions.mockResolvedValue({ suggestions: [] });
    getPlacePredictions.mockReset();
  });

  const type = (value: string) =>
    fireEvent.change(screen.getByPlaceholderText("Buscar en Google Maps"), {
      target: { value },
    });

  describe("with the Places (New) API", () => {
    beforeEach(() => {
      placesLibRef.current = {
        AutocompleteSessionToken: FakeSessionToken,
        AutocompleteSuggestion: { fetchAutocompleteSuggestions },
      };
    });

    it("does not bias suggestions to a country by default", async () => {
      render(<GooglePlaceAutocomplete onPlaceSelect={vi.fn()} />);

      type("Av. Larco 345, Miraflores");

      await waitFor(() => expect(fetchAutocompleteSuggestions).toHaveBeenCalled());
      const request = fetchAutocompleteSuggestions.mock.calls[0][0];
      expect(request).not.toHaveProperty("region");
      expect(request.input).toBe("Av. Larco 345, Miraflores");
      expect(request.language).toBe("es");
    });

    it("forwards an explicit region as a bias only", async () => {
      render(<GooglePlaceAutocomplete onPlaceSelect={vi.fn()} region="PE" />);

      type("Miraflores");

      await waitFor(() => expect(fetchAutocompleteSuggestions).toHaveBeenCalled());
      const request = fetchAutocompleteSuggestions.mock.calls[0][0];
      expect(request.region).toBe("PE");
    });
  });

  describe("with the legacy AutocompleteService", () => {
    beforeEach(() => {
      placesLibRef.current = {
        AutocompleteSessionToken: FakeSessionToken,
        AutocompleteService: class {
          getPlacePredictions = getPlacePredictions;
        },
      };
    });

    it("does not bias predictions to a country by default", async () => {
      render(<GooglePlaceAutocomplete onPlaceSelect={vi.fn()} />);

      type("Miraflores");

      await waitFor(() => expect(getPlacePredictions).toHaveBeenCalled());
      const request = getPlacePredictions.mock.calls[0][0];
      expect(request).not.toHaveProperty("region");
    });

    it("forwards an explicit region", async () => {
      render(<GooglePlaceAutocomplete onPlaceSelect={vi.fn()} region="PE" />);

      type("Miraflores");

      await waitFor(() => expect(getPlacePredictions).toHaveBeenCalled());
      expect(getPlacePredictions.mock.calls[0][0].region).toBe("PE");
    });
  });
});
