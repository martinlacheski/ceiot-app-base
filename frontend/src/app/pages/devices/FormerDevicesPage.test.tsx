import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { devices } = vi.hoisted(() => ({ devices: vi.fn() }));
vi.mock("@/api/deviceHistory.api", () => ({ deviceHistoryApi: { devices } }));
vi.mock("@/app/services/environment.service", () => ({ environmentService: { getAll: vi.fn().mockResolvedValue({ items: [], total: 0 }) } }));
vi.mock("@/auth/store/auth.store", () => ({ useAuthStore: (selector: (state: unknown) => unknown) => selector({ user: null, isAdmin: () => false }) }));
import FormerDevicesPage from "./FormerDevicesPage";
function Opened() { const location = useLocation(); return <p>Opened {location.search}</p>; }

describe("former devices list", () => {
  beforeEach(() => devices.mockReset());
  it("opens the serial in its exact historical establishment", async () => {
    devices.mockResolvedValue({ items: [
      { serial: "SN-1", environmentId: "env-1", environmentName: "North", firstSeen: null, lastSeen: null, readingsCount: 1, operationsCount: 0, isFormer: true },
      { serial: "SN-1", environmentId: "env-2", environmentName: "South", firstSeen: null, lastSeen: null, readingsCount: 2, operationsCount: 0, isFormer: true },
    ], total: 2, page: 1, perPage: 10, pages: 1 });
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={["/app/devices/history"]}><Routes><Route path="/app/devices/history" element={<FormerDevicesPage />} /><Route path="/app/devices/history/:serial" element={<Opened />} /></Routes></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText("North")).toBeInTheDocument();
    expect(screen.getByText("South")).toBeInTheDocument();
    expect(devices).toHaveBeenCalledWith(expect.objectContaining({ perPage: 10 }));
    await userEvent.click(screen.getAllByRole("button", { name: "Ver historial" })[0]);
    expect(screen.getByText("Opened ?environmentId=env-1")).toBeInTheDocument();
  });
});
