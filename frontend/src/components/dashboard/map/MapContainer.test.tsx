import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeviceMapItem } from "@/interfaces/device-map.interface";
import { MapContainer } from "./MapContainer";

vi.mock("@vis.gl/react-google-maps", () => ({
  APIProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Map: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AdvancedMarker: ({
    onClick,
    title,
    children,
  }: {
    onClick: () => void;
    title: string;
    children?: React.ReactNode;
  }) => (
    <button type="button" aria-label={`marker-${title}`} onClick={onClick}>
      {children}
    </button>
  ),
  AdvancedMarkerAnchorPoint: { CENTER: "CENTER" },
  InfoWindow: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="info-window">{children}</div>
  ),
}));

const device: DeviceMapItem = {
  id: "device-1", name: "Sensor Norte", status: "online", ownerId: "owner-1",
  lastMessage: null,
  location: { address: "Calle 1", city: "Córdoba", lat: -31.4, lng: -64.2 },
};

const device2: DeviceMapItem = {
  id: "device-2", name: "Sensor Sur", status: "offline", ownerId: "owner-1",
  lastMessage: null,
  location: { address: "Calle 1", city: "Córdoba", lat: -31.4, lng: -64.2 },
};

function renderMap(devices: DeviceMapItem[] = [device]) {
  return render(<MemoryRouter initialEntries={["/app/map"]}><Routes>
    <Route path="/app/map" element={<MapContainer devices={devices} />} />
    <Route path="/app/devices/:id" element={<div>Detalle abierto</div>} />
  </Routes></MemoryRouter>);
}

function setViewport(mobile: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({ matches: mobile, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  });
}

describe("MapContainer mobile details", () => {
  afterEach(() => Reflect.deleteProperty(window, "matchMedia"));

  it("opens a bottom sheet instead of an InfoWindow and clears selection on close", async () => {
    setViewport(true);
    const user = userEvent.setup();
    renderMap();
    await user.click(screen.getByRole("button", { name: "marker-Sensor Norte" }));
    expect(screen.queryByTestId("info-window")).not.toBeInTheDocument();
    const sheet = screen.getByRole("dialog");
    expect(sheet).toHaveAttribute("data-slot", "sheet-content");
    expect(sheet).toHaveClass("max-h-[70vh]", "overflow-y-auto");
    expect(within(sheet).getByRole("heading", { name: "Sensor Norte" })).toBeInTheDocument();
    expect(sheet).toHaveTextContent("Calle 1, Córdoba");
    expect(sheet).toHaveTextContent("En línea");
    expect(within(sheet).getByRole("button", { name: "Ver detalles" })).toHaveClass("min-h-11", "w-full");
    await user.click(within(sheet).getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("navigates to the device detail from the mobile panel", async () => {
    setViewport(true);
    const user = userEvent.setup();
    renderMap();
    await user.click(screen.getByRole("button", { name: "marker-Sensor Norte" }));
    await user.click(screen.getByRole("button", { name: "Ver detalles" }));
    expect(screen.getByText("Detalle abierto")).toBeInTheDocument();
  });

  it("preserves the desktop InfoWindow", async () => {
    setViewport(false);
    renderMap();
    await userEvent.click(screen.getByRole("button", { name: "marker-Sensor Norte" }));
    expect(screen.getByTestId("info-window")).toHaveTextContent("Sensor Norte");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("MapContainer location grouping", () => {
  afterEach(() => Reflect.deleteProperty(window, "matchMedia"));

  it("draws a single marker for two devices sharing coordinates", () => {
    setViewport(false);
    renderMap([device, device2]);

    expect(
      screen.queryByRole("button", { name: "marker-Sensor Norte" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Calle 1: 2 dispositivos/ }),
    ).toBeInTheDocument();
  });

  it("lists every device of the location, with name and status, in the desktop InfoWindow", async () => {
    setViewport(false);
    const user = userEvent.setup();
    renderMap([device, device2]);

    await user.click(
      screen.getByRole("button", { name: /Calle 1: 2 dispositivos/ }),
    );

    const infoWindow = screen.getByTestId("info-window");
    expect(infoWindow).toHaveTextContent("Sensor Norte");
    expect(infoWindow).toHaveTextContent("Sensor Sur");
    expect(infoWindow).toHaveTextContent("En línea");
    expect(infoWindow).toHaveTextContent("Fuera de línea");
    expect(
      within(infoWindow).getAllByRole("button", { name: "Ver detalles" }),
    ).toHaveLength(2);
  });

  it("lists every device of the location in the mobile bottom sheet", async () => {
    setViewport(true);
    const user = userEvent.setup();
    renderMap([device, device2]);

    await user.click(
      screen.getByRole("button", { name: /Calle 1: 2 dispositivos/ }),
    );

    const sheet = screen.getByRole("dialog");
    expect(sheet).toHaveTextContent("Sensor Norte");
    expect(sheet).toHaveTextContent("Sensor Sur");
    expect(
      within(sheet).getAllByRole("button", { name: "Ver detalles" }),
    ).toHaveLength(2);
  });

  it("navigates to the selected device's own detail from a grouped location", async () => {
    setViewport(true);
    const user = userEvent.setup();
    renderMap([device, device2]);

    await user.click(
      screen.getByRole("button", { name: /Calle 1: 2 dispositivos/ }),
    );
    const buttons = within(screen.getByRole("dialog")).getAllByRole("button", {
      name: "Ver detalles",
    });
    await user.click(buttons[1]);

    expect(screen.getByText("Detalle abierto")).toBeInTheDocument();
  });

  it("draws separate markers for devices at different coordinates", () => {
    setViewport(false);
    const other: DeviceMapItem = {
      ...device2,
      id: "device-3",
      location: { address: "Otra calle", city: "Rosario", lat: -32.9, lng: -60.6 },
    };
    renderMap([device, other]);

    expect(
      screen.getByRole("button", { name: "marker-Sensor Norte" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "marker-Sensor Sur" }),
    ).toBeInTheDocument();
  });
});
