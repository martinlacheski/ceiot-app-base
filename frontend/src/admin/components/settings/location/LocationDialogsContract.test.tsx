import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CityDialog } from "./CityDialog";
import { StateDialog } from "./StateDialog";

const mocks = vi.hoisted(() => ({
  createCity: vi.fn(),
  createState: vi.fn(),
  updateCity: vi.fn((_input: unknown) => Promise.resolve({})),
  updateState: vi.fn((_input: unknown) => Promise.resolve({})),
}));

vi.mock("@/admin/actions/location.actions", () => ({
  createCityAction: mocks.createCity,
  createStateAction: mocks.createState,
  updateCityAction: mocks.updateCity,
  updateStateAction: mocks.updateState,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderDialog(element: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

  render(
    <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>,
  );

  return { invalidateQueries };
}

describe("legacy location dialog read/write contract", () => {
  beforeEach(() => vi.clearAllMocks());

  it("derives the state update country_id from the nested camelCase read", async () => {
    const { invalidateQueries } = renderDialog(
      <StateDialog
        open
        onOpenChange={vi.fn()}
        item={{
          id: "state-1",
          name: "Mendoza",
          isActive: false,
          country: { id: "country-1", name: "Argentina", isActive: true },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(mocks.updateState.mock.calls[0]?.[0]).toEqual({
        id: "state-1",
        data: {
          name: "Mendoza",
          is_active: false,
          country_id: "country-1",
        },
      }),
    );
    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["states", "country-1"],
      }),
    );
  });

  it("derives the city update state_id from the nested camelCase read", async () => {
    const { invalidateQueries } = renderDialog(
      <CityDialog
        open
        onOpenChange={vi.fn()}
        item={{
          id: "city-1",
          name: "Godoy Cruz",
          postalCode: "5501",
          isActive: false,
          state: {
            id: "state-1",
            name: "Mendoza",
            isActive: true,
            country: { id: "country-1", name: "Argentina", isActive: true },
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(mocks.updateCity.mock.calls[0]?.[0]).toEqual({
        id: "city-1",
        data: {
          name: "Godoy Cruz",
          postal_code: "5501",
          is_active: false,
          state_id: "state-1",
        },
      }),
    );
    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["cities", "state-1"],
      }),
    );
  });
});
