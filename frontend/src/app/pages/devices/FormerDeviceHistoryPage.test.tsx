import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/api/deviceHistory.api", () => ({ deviceHistoryApi: {
  readings: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, perPage: 10, pages: 0 }),
  operations: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, perPage: 10, pages: 0 }),
} }));

import FormerDeviceHistoryPage from "./FormerDeviceHistoryPage";

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
});
