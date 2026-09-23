import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/api/deviceHistory.api", () => ({ deviceHistoryApi: {
  readings: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, perPage: 10, pages: 0 }),
  operations: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, perPage: 10, pages: 0 }),
} }));
vi.mock("@/lib/downloadReport", () => ({ downloadReport: vi.fn().mockResolvedValue(undefined) }));

import FormerDeviceHistoryPage from "./FormerDeviceHistoryPage";
import { deviceHistoryApi } from "@/api/deviceHistory.api";

describe("device history page", () => {
  it("opens telemetry first and keeps operations mounted under the same environment", async () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={["/app/devices/history/SN-1?environmentId=env-1"]}><Routes><Route path="/app/devices/history/:serial" element={<FormerDeviceHistoryPage />} /></Routes></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByRole("heading", { name: /Historial: SN-1/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Telemetría" })).toHaveAttribute("data-state", "active");
    expect(screen.getByRole("tab", { name: "Operaciones" })).toBeInTheDocument();
  });

  it("preserves each tab's search when switching and places dates beside filters", async () => {
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={["/app/devices/history/SN-1?environmentId=env-1"]}><Routes><Route path="/app/devices/history/:serial" element={<FormerDeviceHistoryPage />} /></Routes></MemoryRouter></QueryClientProvider>);
    const telemetry = screen.getByRole("tab", { name: "Telemetría" });
    const operations = screen.getByRole("tab", { name: "Operaciones" });
    const search = within(screen.getByRole("tabpanel", { name: "Telemetría" })).getByPlaceholderText("Buscar en todos los campos...");
    await user.type(search, "sensor");
    expect(within(screen.getByRole("tabpanel", { name: "Telemetría" })).getByLabelText("Fecha desde")).toBeInTheDocument();
    await user.click(operations);
    await user.click(telemetry);
    expect(within(screen.getByRole("tabpanel", { name: "Telemetría" })).getByPlaceholderText("Buscar en todos los campos...")).toHaveValue("sensor");
  });

  it("queries server-filtered pages instead of fetching all rows or filtering them locally", async () => {
    const user = userEvent.setup();
    const readings = vi.mocked(deviceHistoryApi.readings);
    readings.mockResolvedValue({ items: [{ id: "r-1", time: "2026-08-31T12:00:00Z", temperatureC: 22 } as never], total: 1, page: 1, perPage: 10, pages: 1 });
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={["/app/devices/history/SN-1?environmentId=env-1"]}><Routes><Route path="/app/devices/history/:serial" element={<FormerDeviceHistoryPage />} /></Routes></MemoryRouter></QueryClientProvider>);
    await user.type(within(screen.getByRole("tabpanel", { name: "Telemetría" })).getByLabelText("Fecha desde"), "2026-09-01");
    await waitFor(() => expect(readings).toHaveBeenCalledWith("SN-1", expect.objectContaining({ dateFrom: "2026-09-01", page: 1, perPage: 10 })));
    expect(readings.mock.calls.every(([, params]) => params.perPage === 10)).toBe(true);
    expect(await screen.findByText("22 °C")).toBeInTheDocument();
  });

  it("exports every server-filtered row with the selected date range", async () => {
    const user = userEvent.setup();
    const readings = vi.mocked(deviceHistoryApi.readings);
    readings.mockResolvedValue({ items: [{ id: "r-1", time: "2026-09-01T12:00:00Z", temperatureC: 22 } as never], total: 1, page: 1, perPage: 10, pages: 1 });
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={["/app/devices/history/SN-1?environmentId=env-1"]}><Routes><Route path="/app/devices/history/:serial" element={<FormerDeviceHistoryPage />} /></Routes></MemoryRouter></QueryClientProvider>);
    const tab = screen.getByRole("tabpanel", { name: "Telemetría" });
    await user.type(within(tab).getByLabelText("Fecha desde"), "2026-09-01");
    await waitFor(() => expect(within(tab).getByRole("button", { name: "Excel" })).toBeEnabled());
    await user.click(within(tab).getByRole("button", { name: "Excel" }));
    await waitFor(() => expect(readings).toHaveBeenCalledWith("SN-1", expect.objectContaining({ dateFrom: "2026-09-01", page: 1, perPage: 10000 })));
  });
});
