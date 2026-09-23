import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router";

import MapPage from "./MapPage";

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: [
      {
        id: "dev-1",
        name: "Dispositivo 1",
        status: "online",
        location: {
          address: "Calle Falsa 123",
          city: "Córdoba",
          lat: -31.4,
          lng: -64.2,
        },
      },
    ],
  }),
}));

vi.mock("@/components/dashboard/map/MapContainer", () => ({
  MapContainer: () => <div>Mapa mock</div>,
}));

describe("MapPage", () => {
  it("muestra textos de dispositivos y navega a /app/devices", () => {
    render(
      <MemoryRouter>
        <MapPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Mapa" })).toBeInTheDocument();
    expect(
      screen.getByText("Visualización geográfica de todos los dispositivos"),
    ).toBeInTheDocument();
    expect(screen.getByText("Dispositivos")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: /Dispositivo 1/i })).toHaveAttribute(
      "href",
      "/app/devices/dev-1",
    );
  });
});
