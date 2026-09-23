import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import EditCityPage from "./EditCityPage";
import EditCountryPage from "./EditCountryPage";
import EditStatePage from "./EditStatePage";

const mocks = vi.hoisted(() => ({
  updateCountry: vi.fn(),
  updateState: vi.fn(),
  updateCity: vi.fn(),
}));

vi.mock("@/admin/hooks/useLocations", () => ({
  useCountry: () => ({
    data: { id: "country-1", name: "Argentina", isActive: false },
    isLoading: false,
    error: null,
  }),
  useLocationState: () => ({
    data: {
      id: "state-1",
      name: "Mendoza",
      isActive: false,
      country: { id: "country-1", name: "Argentina", isActive: true },
    },
    isLoading: false,
    isError: false,
  }),
  useLocationCity: () => ({
    data: {
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
    },
    isLoading: false,
    isError: false,
  }),
  useUpdateCountry: () => ({ mutateAsync: mocks.updateCountry, isPending: false }),
  useUpdateState: () => ({ mutateAsync: mocks.updateState, isPending: false }),
  useUpdateCity: () => ({ mutateAsync: mocks.updateCity, isPending: false }),
}));

vi.mock("@/admin/components/settings/location/CountryForm", () => ({
  CountryForm: ({ defaultValues, onSubmit }: { defaultValues: unknown; onSubmit: (values: unknown) => void }) => (
    <>
      <output data-testid="country-defaults">{JSON.stringify(defaultValues)}</output>
      <button onClick={() => onSubmit({ name: "Argentina", is_active: false })}>submit country</button>
    </>
  ),
}));

vi.mock("@/admin/components/settings/location/StateForm", () => ({
  StateForm: ({ defaultValues, onSubmit }: { defaultValues: unknown; onSubmit: (values: unknown) => void }) => (
    <>
      <output data-testid="state-defaults">{JSON.stringify(defaultValues)}</output>
      <button onClick={() => onSubmit({ name: "Mendoza", country_id: "country-1", is_active: false })}>submit state</button>
    </>
  ),
}));

vi.mock("@/admin/components/settings/location/CityForm", () => ({
  CityForm: ({ defaultValues, onSubmit }: { defaultValues: unknown; onSubmit: (values: unknown) => void }) => (
    <>
      <output data-testid="city-defaults">{JSON.stringify(defaultValues)}</output>
      <button onClick={() => onSubmit({ name: "Godoy Cruz", postal_code: "5501", state_id: "state-1", is_active: false })}>submit city</button>
    </>
  ),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function renderPage(path: string, element: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/edit/:id" element={element} />
        <Route path="*" element={<div>navigated</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("location edit read/write contract", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps a camelCase country read into snake_case edit defaults and update payload", async () => {
    renderPage("/edit/country-1", <EditCountryPage />);

    expect(screen.getByTestId("country-defaults")).toHaveTextContent(
      JSON.stringify({ name: "Argentina", is_active: false }),
    );
    fireEvent.click(screen.getByRole("button", { name: "submit country" }));
    await waitFor(() => expect(mocks.updateCountry).toHaveBeenCalledWith({
      id: "country-1",
      data: { name: "Argentina", is_active: false },
    }));
  });

  it("preselects the nested country and keeps the state update payload snake_case", async () => {
    renderPage("/edit/state-1", <EditStatePage />);

    expect(screen.getByTestId("state-defaults")).toHaveTextContent(
      JSON.stringify({ name: "Mendoza", country_id: "country-1", is_active: false }),
    );
    fireEvent.click(screen.getByRole("button", { name: "submit state" }));
    await waitFor(() => expect(mocks.updateState).toHaveBeenCalledWith({
      id: "state-1",
      data: { name: "Mendoza", country_id: "country-1", is_active: false },
    }));
  });

  it("preselects nested state/country, maps postalCode, and keeps the city update payload snake_case", async () => {
    renderPage("/edit/city-1", <EditCityPage />);

    expect(screen.getByTestId("city-defaults")).toHaveTextContent(
      JSON.stringify({
        name: "Godoy Cruz",
        postal_code: "5501",
        state_id: "state-1",
        country_id: "country-1",
        is_active: false,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "submit city" }));
    await waitFor(() => expect(mocks.updateCity).toHaveBeenCalledWith({
      id: "city-1",
      data: { name: "Godoy Cruz", postal_code: "5501", state_id: "state-1", is_active: false },
    }));
  });
});
