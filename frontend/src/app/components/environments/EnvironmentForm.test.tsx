import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EnvironmentForm } from "./EnvironmentForm";

const {
  resolveLocationActionMock,
  ensureEnvironmentTypeActionMock,
  latestMapPropsRef,
  latestAutocompletePropsRef,
  invalidateQueriesMock,
} = vi.hoisted(() => ({
  resolveLocationActionMock: vi.fn(),
  ensureEnvironmentTypeActionMock: vi.fn(),
  latestMapPropsRef: { current: {} as Record<string, unknown> },
  latestAutocompletePropsRef: { current: {} as Record<string, unknown> },
  invalidateQueriesMock: vi.fn(),
}));

vi.mock("@/admin/actions/location.actions", () => ({
  resolveLocationAction: resolveLocationActionMock,
}));

vi.mock("@/admin/actions/environment.actions", () => ({
  ensureEnvironmentTypeAction: ensureEnvironmentTypeActionMock,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const scope = queryKey[0];
    if (scope === "environmentTypes") {
      return { data: { items: [] }, isLoading: false };
    }
    if (String(scope).startsWith("mp-")) {
      throw new Error("EnvironmentForm must not query Mercado Pago catalogs");
    }
    return { data: undefined, isLoading: false };
  },
  useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
}));

vi.mock("@/store/confirm.store", () => ({
  useConfirmStore: () => ({
    openConfirm: (_message: string, onConfirm: () => Promise<void> | void) => {
      void onConfirm();
    },
  }),
}));

vi.mock("@/components/custom/CitySelector", () => ({
  CitySelector: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <input
      aria-label="Ciudad"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

vi.mock("@/components/custom/SmartPhoneInput", () => ({
  SmartPhoneInput: ({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) => (
    <input
      aria-label={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

vi.mock("@/components/custom/SearchableSelect", () => ({
  SearchableSelect: ({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) => (
    <input
      aria-label={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
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

describe("EnvironmentForm", () => {
  beforeEach(() => {
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    resolveLocationActionMock.mockReset();
    ensureEnvironmentTypeActionMock.mockReset();
    invalidateQueriesMock.mockReset();
    latestMapPropsRef.current = {};
    latestAutocompletePropsRef.current = {};
  });

  it("prioriza la dirección textual exacta de Places aunque difiera el street_number reconstruido", async () => {
    resolveLocationActionMock.mockResolvedValue({
      address: "Dirección aproximada del reverse geocode",
      city_id: "city-2",
      latitude: -34.6037,
      longitude: -58.3816,
    });

    render(<EnvironmentForm onSubmit={vi.fn()} />);

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
        types: [],
      });
    });

    expect(resolveLocationActionMock).toHaveBeenCalledWith("-34.6037,-58.3816");

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Ingrese la dirección")).toHaveValue(
        "España 134, Posadas, Misiones, Argentina",
      );
    });
  });

  it("usa reverse geocode cuando el usuario hace click manual en el mapa", async () => {
    resolveLocationActionMock.mockResolvedValue({
      address: "Calle ajustada 456, Posadas",
      city_id: "city-3",
      latitude: -27.3621,
      longitude: -55.9009,
    });

    render(<EnvironmentForm onSubmit={vi.fn()} />);

    await act(async () => {
      await (latestMapPropsRef.current.onClick as (event: unknown) => Promise<void>)({
        detail: {
          latLng: { lat: () => -27.3621, lng: () => -55.9009 },
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Ingrese la dirección")).toHaveValue(
        "Calle ajustada 456, Posadas",
      );
    });
  });

  it("usa la dirección del geocoder cuando Places no trae calle y número suficientes", async () => {
    resolveLocationActionMock.mockResolvedValue({
      address: "Avenida Uruguay 4098, Posadas, Misiones, Argentina",
      city_id: "city-4",
      latitude: -27.3621,
      longitude: -55.9009,
    });

    render(<EnvironmentForm onSubmit={vi.fn()} />);

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
        types: [],
      });
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Ingrese la dirección")).toHaveValue(
        "Avenida Uruguay 4098, Posadas, Misiones, Argentina",
      );
    });
  });

  it("mantiene sincronizado el centro del mapa cuando el usuario arrastra", async () => {
    render(
      <EnvironmentForm
        onSubmit={vi.fn()}
        defaultValues={{
          address: "Av. Siempre Viva 742",
          cityId: "city-1",
          location: "-34.6037, -58.3816",
        }}
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

  it("oculta el campo visible de ciudad y deja dirección en solo lectura", () => {
    render(
      <EnvironmentForm
        onSubmit={vi.fn()}
        defaultValues={{
          address: "Av. Siempre Viva 742",
          cityId: "city-1",
        }}
      />,
    );

    expect(screen.queryByLabelText("Ciudad")).not.toBeInTheDocument();

    const addressInput = screen.getByPlaceholderText("Ingrese la dirección");
    expect(addressInput).toHaveAttribute("readonly");
  });

  it("keeps extra actions in the generic footer without Mercado Pago controls", () => {
    render(
      <EnvironmentForm
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        submitLabel="Guardar Cambios"
        cancelLabel="Volver"
        afterDescriptionContent={
          <button type="button">Gestionar invitados y comisiones</button>
        }
      />,
    );

    const descriptionLabel = screen.getByText("Descripción");
    const manageGuestsButton = screen.getByRole("button", {
      name: "Gestionar invitados y comisiones",
    });
    const cancelButton = screen.getByRole("button", { name: "Volver" });
    const submitButton = screen.getByRole("button", {
      name: "Guardar Cambios",
    });

    expect(descriptionLabel).toBeInTheDocument();
    expect(screen.queryByText(/Mercado Pago/i)).not.toBeInTheDocument();

    const footer = cancelButton.parentElement?.parentElement;
    expect(footer).toContainElement(manageGuestsButton);
    expect(footer).toContainElement(cancelButton);
    expect(footer).toContainElement(submitButton);
  });

  it("conserva el nombre accesible al guardar mientras está pendiente", () => {
    render(
      <EnvironmentForm
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        isSubmitting
        submitLabel="Guardar Cambios"
        cancelLabel="Volver"
      />,
    );

    expect(screen.getByRole("button", { name: "Volver" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Guardar Cambios" }),
    ).toBeDisabled();
  });

  it("submits ordinary environment fields without requiring provider geography", async () => {
    const onSubmit = vi.fn();
    render(
      <EnvironmentForm
        onSubmit={onSubmit}
        defaultValues={{
          name: "Sucursal Centro",
          address: "Calle 123",
          location: "-27.36, -55.90",
          description: "Principal",
          cityId: "city-1",
          typeId: "type-1",
          phone: "+5493764000000",
          isActive: true,
        }}
      />,
    );

    screen.getByRole("button", { name: "Guardar Cambios" }).click();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual({
      name: "Sucursal Centro",
      address: "Calle 123",
      location: "-27.36, -55.90",
      description: "Principal",
      cityId: "city-1",
      typeId: "type-1",
      phone: "+5493764000000",
      isActive: true,
    });
  });

  it("does not force the map to the former 44rem minimum height", () => {
    render(<EnvironmentForm onSubmit={vi.fn()} />);

    const mapContainer = screen.getByTestId("environment-map-container");
    expect(mapContainer.className).toContain("xl:min-h-[24rem]");
    expect(mapContainer.className).not.toContain("xl:min-h-[44rem]");
  });

  it("does not render Mercado Pago location, status, or retry affordances", () => {
    render(<EnvironmentForm onSubmit={vi.fn()} />);

    expect(screen.queryByText(/Mercado Pago/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reintentar/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Estado actual:/i)).not.toBeInTheDocument();
  });
});
