import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddressMapDialog } from "./AddressMapDialog";

const {
  resolveLocationActionMock,
  latestMapPropsRef,
  latestAutocompletePropsRef,
} = vi.hoisted(() => ({
  resolveLocationActionMock: vi.fn(),
  latestMapPropsRef: { current: {} as Record<string, unknown> },
  latestAutocompletePropsRef: { current: {} as Record<string, unknown> },
}));

vi.mock("@/admin/actions/location.actions", () => ({
  resolveLocationAction: resolveLocationActionMock,
}));

vi.mock("@vis.gl/react-google-maps", () => ({
  AdvancedMarker: () => <div>marker</div>,
  APIProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ControlPosition: { TOP_CENTER: "TOP_CENTER" },
  Map: (props: { children: ReactNode }) => {
    latestMapPropsRef.current = props as unknown as Record<string, unknown>;
    return <div>{props.children}</div>;
  },
  MapControl: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useMapsLibrary: () => null,
}));

vi.mock("@/components/custom/GooglePlaceAutocomplete", () => ({
  GooglePlaceAutocomplete: (props: Record<string, unknown>) => {
    latestAutocompletePropsRef.current = props;
    return <div>autocomplete</div>;
  },
}));

describe("AddressMapDialog", () => {
  beforeEach(() => {
    resolveLocationActionMock.mockReset();
    latestMapPropsRef.current = {};
    latestAutocompletePropsRef.current = {};
  });

  it("confirma la dirección inicial sin tocar el formulario hasta aceptar", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <AddressMapDialog
        open={true}
        onOpenChange={onOpenChange}
        initialAddress="Av. Siempre Viva 742"
        initialCityId="city-1"
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText("Ingresar dirección")).toBeInTheDocument();
    expect(screen.getByText("Av. Siempre Viva 742")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /confirmar dirección/i }),
    );

    expect(onConfirm).toHaveBeenCalledWith({
      address: "Av. Siempre Viva 742",
      cityId: "city-1",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("prioriza la dirección textual exacta de Places aunque difiera el street_number reconstruido", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    resolveLocationActionMock.mockResolvedValue({
      address: "Dirección aproximada del reverse geocode",
      city_id: "city-2",
      latitude: -34.6037,
      longitude: -58.3816,
    });

    render(
      <AddressMapDialog
        open={true}
        onOpenChange={vi.fn()}
        initialAddress=""
        initialCityId=""
        onConfirm={onConfirm}
      />,
    );

    await act(async () => {
      await (
        latestAutocompletePropsRef.current.onPlaceSelect as (
          place: unknown,
        ) => Promise<void>
      )({
        formattedAddress: "España 134, Posadas, Misiones, Argentina",
        addressComponents: [
          { longText: "España", types: ["route"] },
          { longText: "153", types: ["street_number"] },
          { longText: "Posadas", types: ["locality"] },
          {
            longText: "Misiones",
            types: ["administrative_area_level_1"],
          },
          { longText: "Argentina", types: ["country"] },
        ],
        location: { lat: -34.6037, lng: -58.3816 },
      });
    });

    expect(resolveLocationActionMock).toHaveBeenCalledWith("-34.6037,-58.3816");
    expect(screen.getByText("España 134, Posadas, Misiones, Argentina")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /confirmar dirección/i }),
    );

    expect(onConfirm).toHaveBeenCalledWith({
      address: "España 134, Posadas, Misiones, Argentina",
      cityId: "city-2",
    });
  });

  it("usa el reverse geocode cuando el usuario ajusta manualmente con click en el mapa", async () => {
    resolveLocationActionMock.mockResolvedValue({
      address: "Calle ajustada 456, Posadas",
      city_id: "city-3",
      latitude: -27.3621,
      longitude: -55.9009,
    });

    render(
      <AddressMapDialog
        open={true}
        onOpenChange={vi.fn()}
        initialAddress=""
        initialCityId=""
        onConfirm={vi.fn()}
      />,
    );

    await act(async () => {
      await (latestMapPropsRef.current.onClick as (event: unknown) => Promise<void>)({
        detail: {
          latLng: { lat: () => -27.3621, lng: () => -55.9009 },
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Calle ajustada 456, Posadas")).toBeInTheDocument();
    });
  });

  it("usa la dirección del geocoder cuando Places no trae calle y número suficientes", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    resolveLocationActionMock.mockResolvedValue({
      address: "Avenida Uruguay 4098, Posadas, Misiones, Argentina",
      city_id: "city-4",
      latitude: -27.3621,
      longitude: -55.9009,
    });

    render(
      <AddressMapDialog
        open={true}
        onOpenChange={vi.fn()}
        initialAddress=""
        initialCityId=""
        onConfirm={onConfirm}
      />,
    );

    await act(async () => {
      await (
        latestAutocompletePropsRef.current.onPlaceSelect as (
          place: unknown,
        ) => Promise<void>
      )({
        formattedAddress: "Sur Express, Posadas, Misiones, Argentina",
        addressComponents: [
          { longText: "Posadas", types: ["locality"] },
          {
            longText: "Misiones",
            types: ["administrative_area_level_1"],
          },
          { longText: "Argentina", types: ["country"] },
        ],
        location: { lat: -27.3621, lng: -55.9009 },
      });
    });

    await waitFor(() => {
      expect(
        screen.getByText("Avenida Uruguay 4098, Posadas, Misiones, Argentina"),
      ).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", { name: /confirmar dirección/i }),
    );

    expect(onConfirm).toHaveBeenCalledWith({
      address: "Avenida Uruguay 4098, Posadas, Misiones, Argentina",
      cityId: "city-4",
    });
  });

  it("sincroniza el centro del mapa cuando el usuario arrastra la cámara", async () => {
    render(
      <AddressMapDialog
        open={true}
        onOpenChange={vi.fn()}
        initialAddress="-34.6037, -58.3816"
        initialCityId="city-1"
        onConfirm={vi.fn()}
      />,
    );

    expect(latestMapPropsRef.current.center).toEqual({
      lat: -34.6037,
      lng: -58.3816,
    });

    await act(async () => {
      (latestMapPropsRef.current.onCameraChanged as (event: unknown) => void)({
        detail: { center: { lat: -34.61, lng: -58.39 } },
      });
    });

    await waitFor(() => {
      expect(latestMapPropsRef.current.center).toEqual({
        lat: -34.61,
        lng: -58.39,
      });
    });
  });
});
