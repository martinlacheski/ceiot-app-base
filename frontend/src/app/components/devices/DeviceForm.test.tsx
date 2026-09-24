import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { DeviceForm } from "./DeviceForm";

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [{ id: "sensor-1", code: "dht22", name: "DHT22", variables: [{ code: "temperature", name: "Temperatura", unit: "°C", min: -40, max: 80 }] }] }),
}));

const DEVICE_TYPE_ID = "6a8e2b8d-2f9d-4f8d-8b7b-5b8f8e4d2c32";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverMock);

vi.mock("@/app/hooks/useDevices", () => ({
  useDeviceTypes: () => ({
    data: {
      items: [{ id: DEVICE_TYPE_ID, name: "Ambiental", is_active: true }],
      total: 1,
      page: 1,
      per_page: 100,
      pages: 1,
    },
  }),
  useUnpairDevice: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/auth/store/auth.store", () => ({
  useAuthStore: (selector: (state: { user: { id: string; isAdmin: boolean; permissions: string[] } }) => unknown) =>
    selector({ user: { id: "owner-1", isAdmin: false, permissions: ["device_sensor:write", "sensor_catalog:read"] } }),
}));

vi.mock("@/store/confirm.store", () => ({
  showConfirmDialog: (_message: string, onConfirm: () => void) => onConfirm(),
}));

describe("DeviceForm", () => {
  it("requires sensors for Ambiental and submits repeated models", async () => {
    const onSubmit = vi.fn();
    render(<MemoryRouter><DeviceForm onSubmit={onSubmit} /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Crear Dispositivo" }));
    expect(await screen.findByText("Agregá al menos un sensor")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Agregar sensor" }));
    const section = screen.getByRole("region", { name: "Sensores" });
    expect(screen.getByLabelText("Descripción").compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section).not.toHaveClass("border", "rounded-md", "bg-muted/50");
    expect(section.querySelector(":scope > div")).not.toHaveClass("border", "bg-background");
    expect(screen.queryByLabelText(/clave/i)).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Modelo del sensor 1"), "sensor-1");
    expect(section).toHaveTextContent("Temperatura: -40–80 °C");
    await userEvent.click(screen.getByRole("button", { name: "Agregar sensor" }));
    await userEvent.selectOptions(screen.getByLabelText("Modelo del sensor 2"), "sensor-1");
    await userEvent.click(screen.getByRole("button", { name: "Crear Dispositivo" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].sensors).toEqual([{ sensorId: "sensor-1" }, { sensorId: "sensor-1" }]);
  });
  it("defaults a new device to the Ambiental type", async () => {
    const onSubmit = vi.fn();
    render(<MemoryRouter><DeviceForm onSubmit={onSubmit} /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Agregar sensor" }));
    await userEvent.selectOptions(screen.getByLabelText("Modelo del sensor 1"), "sensor-1");
    await userEvent.click(screen.getByRole("button", { name: "Crear Dispositivo" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].deviceTypeId).toBe(DEVICE_TYPE_ID);
  });
  it("keeps editable device fields and submits no financial keys", async () => {
    const onSubmit = vi.fn();
    render(
      <MemoryRouter>
        <DeviceForm
          isEditing
          mode="user"
          initialData={{
            id: "device-1",
            serial: "IOT-0000-0001",
            name: "Sensor norte",
            description: "Monitoreo",
            deviceTypeId: DEVICE_TYPE_ID,
            status: "active",
            isActive: true,
            enabled: true,
            environmentId: "env-1",
            environment: { ownerId: "owner-1" },
          } as never}
          onSubmit={onSubmit}
        />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("Nombre")).toHaveValue("Sensor norte");
    expect(screen.getByText("Estado")).toBeInTheDocument();
    expect(screen.getByText("Habilitado")).toBeInTheDocument();
    expect(screen.queryByLabelText("Importe")).not.toBeInTheDocument();
    expect(screen.queryByText(/comisión/i)).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Guardar Cambios" }),
    );

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0];
    expect(payload).not.toHaveProperty("amount");
    expect(payload).not.toHaveProperty("dvemCommissionRate");
    expect(payload).not.toHaveProperty("guestCommissionRate");
    expect(payload).not.toHaveProperty("dispenserData");
  });
});
