import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeviceMapItem } from "@/interfaces/device-map.interface";
import { MapContainer } from "./MapContainer";

vi.mock("@vis.gl/react-google-maps", () => ({
  APIProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Map: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AdvancedMarker: ({ onClick, title }: { onClick: () => void; title: string }) => (
    <button type="button" aria-label={`marker-${title}`} onClick={onClick} />
  ),
  InfoWindow: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="info-window">{children}</div>
  ),
}));

const device: DeviceMapItem = {
  id: "device-1", name: "Sensor Norte", status: "online", ownerId: "owner-1",
  lastMessage: null,
  location: { address: "Calle 1", city: "Córdoba", lat: -31.4, lng: -64.2 },
};

function renderMap() {
  return render(<MemoryRouter initialEntries={["/app/map"]}><Routes>
    <Route path="/app/map" element={<MapContainer devices={[device]} />} />
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
