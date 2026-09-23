import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createMemoryRouter,
  MemoryRouter,
  RouterProvider,
  useLocation,
} from "react-router";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { useEnvironmentTypes } from "@/admin/hooks/useEnvironment";
import { useIdentificationTypes } from "@/admin/hooks/useIdentification";
import {
  useCities,
  useCountries,
  useStates,
} from "@/admin/hooks/useLocations";
import { useUsers } from "@/admin/hooks/useUsers";
import { PermissionsTable } from "../permissions/PermissionsTable";
import { EnvironmentTypesTable } from "../settings/environment/EnvironmentTypesTable";
import { IdentificationTypesTable } from "../settings/identification/IdentificationTypesTable";
import { CitiesTable } from "../settings/location/CitiesTable";
import { CountriesTable } from "../settings/location/CountriesTable";
import { StatesTable } from "../settings/location/StatesTable";
import { UsersTable } from "../users/UsersTable";

const refetchUsers = vi.fn();
const refetchPermissions = vi.fn();
const refetchEnvironmentTypes = vi.fn();
const refetchIdentificationTypes = vi.fn();
const refetchCountries = vi.fn();
const refetchStates = vi.fn();
const refetchCities = vi.fn();

let usersResult: Record<string, unknown>;
let permissionsResult: Record<string, unknown>;
let environmentTypesResult: Record<string, unknown>;
let identificationTypesResult: Record<string, unknown>;
let countriesResult: Record<string, unknown>;
let statesResult: Record<string, unknown>;
let citiesResult: Record<string, unknown>;

vi.mock("@/admin/hooks/useUsers", () => ({
  useUsers: vi.fn(() => usersResult),
  useDeleteUser: vi.fn(() => ({ mutate: vi.fn() })),
  useUpdateUser: vi.fn(() => ({ mutate: vi.fn() })),
}));

vi.mock("@/admin/hooks/usePermissions", () => ({
  usePermissions: vi.fn(() => permissionsResult),
}));

vi.mock("@/admin/hooks/useEnvironment", () => ({
  useEnvironmentTypes: vi.fn(() => environmentTypesResult),
  useDeleteEnvironmentType: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useUpdateEnvironmentType: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));

vi.mock("@/admin/hooks/useIdentification", () => ({
  useIdentificationTypes: vi.fn(() => identificationTypesResult),
  useDeleteIdentificationType: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useUpdateIdentificationType: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));

vi.mock("@/admin/hooks/useLocations", () => ({
  useCountries: vi.fn(() => countriesResult),
  useStates: vi.fn(() => statesResult),
  useCities: vi.fn(() => citiesResult),
  useDeleteCountry: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useUpdateCountry: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useDeleteState: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useUpdateState: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useDeleteCity: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useUpdateCity: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));

vi.mock("@/auth/store/auth.store", () => ({
  useAuthStore: vi.fn(() => ({ user: { username: "admin" } })),
}));

vi.mock("@/store/confirm.store", () => ({ showConfirmDialog: vi.fn() }));

vi.mock("@/lib/export.utils", () => ({
  exportToExcel: vi.fn(),
  exportToPdf: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

function LocationSearch() {
  return <output data-testid="location-search">{useLocation().search}</output>;
}

function renderAt(component: React.ReactNode, entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      {component}
      <LocationSearch />
    </MemoryRouter>,
  );
}

async function expectPageReplacement(
  component: React.ReactNode,
  entry: string,
  expectedSearch: string,
) {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <>
            {component}
            <LocationSearch />
          </>
        ),
      },
    ],
    { initialEntries: [entry] },
  );

  render(<RouterProvider router={router} />);

  await waitFor(() =>
    expect(screen.getByTestId("location-search")).toHaveTextContent(
      expectedSearch,
    ),
  );
  expect(router.state.historyAction).toBe("REPLACE");
}

const userRow = {
  id: "user-1",
  username: "admin",
  email: "admin@example.com",
  firstName: "Admin",
  lastName: "User",
  identificationNumber: "123",
  isActive: true,
  isAdmin: true,
  permissions: [],
};
const environmentTypeRow = {
  id: "environment-type-1",
  name: "Hospital",
  is_active: true,
};
const identificationTypeRow = {
  id: "identification-type-1",
  name: "DNI",
  is_active: true,
};
const countryRow = { id: "country-1", name: "Argentina", isActive: true };
const stateRow = {
  id: "state-1",
  name: "Mendoza",
  isActive: true,
  country: countryRow,
};
const cityRow = {
  id: "city-1",
  name: "Godoy Cruz",
  postalCode: "5501",
  isActive: true,
  state: stateRow,
};

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  usersResult = {
    data: { items: [userRow], total: 1, page: 1, per_page: 10, pages: 1 },
    isLoading: false,
    isError: false,
    refetch: refetchUsers,
  };
  permissionsResult = {
    data: {
      groups: [
        {
          label: "Usuarios",
          items: [{ value: "users.read", label: "Ver usuarios", is_basic: true }],
        },
      ],
      basic_permissions: ["users.read"],
    },
    isLoading: false,
    isError: false,
    refetch: refetchPermissions,
  };
  environmentTypesResult = {
    data: { items: [environmentTypeRow], total: 1, pages: 1 },
    isLoading: false,
    isError: false,
    refetch: refetchEnvironmentTypes,
  };
  identificationTypesResult = {
    data: { items: [identificationTypeRow], total: 1, pages: 1 },
    isLoading: false,
    isError: false,
    refetch: refetchIdentificationTypes,
  };
  countriesResult = {
    data: { items: [countryRow], total: 1, pages: 1 },
    isLoading: false,
    isError: false,
    refetch: refetchCountries,
  };
  statesResult = {
    data: { items: [stateRow], total: 1, pages: 1 },
    isLoading: false,
    isError: false,
    refetch: refetchStates,
  };
  citiesResult = {
    data: { items: [cityRow], total: 1, pages: 1 },
    isLoading: false,
    isError: false,
    refetch: refetchCities,
  };
});

describe("admin list retry states", () => {
  it.each([
    {
      name: "users",
      component: <UsersTable />,
      entry: "/admin/users",
      message: "Error al cargar usuarios",
      fail: () => {
        usersResult = { isLoading: false, isError: true, refetch: refetchUsers };
      },
      refetch: refetchUsers,
    },
    {
      name: "permissions",
      component: <PermissionsTable />,
      entry: "/admin/permissions",
      message: "Error al cargar permisos",
      fail: () => {
        permissionsResult = {
          isLoading: false,
          isError: true,
          refetch: refetchPermissions,
        };
      },
      refetch: refetchPermissions,
    },
    {
      name: "environment types",
      component: <EnvironmentTypesTable />,
      entry: "/admin/settings/environment-types",
      message: "Error al cargar tipos de establecimiento",
      fail: () => {
        environmentTypesResult = {
          isLoading: false,
          isError: true,
          refetch: refetchEnvironmentTypes,
        };
      },
      refetch: refetchEnvironmentTypes,
    },
    {
      name: "identification types",
      component: <IdentificationTypesTable />,
      entry: "/admin/settings/identification-types",
      message: "Error al cargar tipos de documentos",
      fail: () => {
        identificationTypesResult = {
          isLoading: false,
          isError: true,
          refetch: refetchIdentificationTypes,
        };
      },
      refetch: refetchIdentificationTypes,
    },
    {
      name: "countries",
      component: <CountriesTable />,
      entry: "/admin/locations/countries",
      message: "Error al cargar países",
      fail: () => {
        countriesResult = {
          isLoading: false,
          isError: true,
          refetch: refetchCountries,
        };
      },
      refetch: refetchCountries,
    },
    {
      name: "states",
      component: <StatesTable />,
      entry: "/admin/locations/states",
      message: "Error al cargar provincias",
      fail: () => {
        statesResult = { isLoading: false, isError: true, refetch: refetchStates };
      },
      refetch: refetchStates,
    },
    {
      name: "cities",
      component: <CitiesTable />,
      entry: "/admin/locations/cities",
      message: "Error al cargar ciudades",
      fail: () => {
        citiesResult = { isLoading: false, isError: true, refetch: refetchCities };
      },
      refetch: refetchCities,
    },
  ])("shows retryable load failure for $name", async ({
    component,
    entry,
    message,
    fail,
    refetch,
  }) => {
    fail();
    const user = userEvent.setup();

    renderAt(component, entry);

    expect(screen.getByText(message)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe("admin list URL pagination", () => {
  it.each([
    ["users", <UsersTable />, "/admin/users?page=abc&size=0", useUsers],
    [
      "environment types",
      <EnvironmentTypesTable />,
      "/admin/settings/environment-types?page=abc&size=0",
      useEnvironmentTypes,
    ],
    [
      "identification types",
      <IdentificationTypesTable />,
      "/admin/settings/identification-types?page=abc&size=0",
      useIdentificationTypes,
    ],
    [
      "countries",
      <CountriesTable />,
      "/admin/locations/countries?page=abc&size=0",
      useCountries,
    ],
    [
      "states",
      <StatesTable />,
      "/admin/locations/states?page=abc&size=0",
      useStates,
    ],
    [
      "cities",
      <CitiesTable />,
      "/admin/locations/cities?page=abc&size=0",
      useCities,
    ],
  ])("uses positive defaults for invalid %s page and size", (
    _name,
    component,
    entry,
    hook,
  ) => {
    renderAt(component, entry);

    expect(vi.mocked(hook)).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, size: 10 }),
    );
  });

  it("replaces an out-of-range users page after rows load", async () => {
    usersResult = {
      data: { items: [], total: 21, page: 99, per_page: 10, pages: 3 },
      isLoading: false,
      isError: false,
      refetch: refetchUsers,
    };
    await expectPageReplacement(<UsersTable />, "/admin/users?page=99&size=10", "page=3&size=10");
  });

  it.each([
    {
      name: "environment types",
      component: <EnvironmentTypesTable />,
      entry: "/admin/settings/environment-types?page=99&size=10",
      setPages: () => {
        environmentTypesResult = {
          data: { items: [], total: 21, pages: 3 },
          isLoading: false,
          isError: false,
          refetch: refetchEnvironmentTypes,
        };
      },
    },
    {
      name: "identification types",
      component: <IdentificationTypesTable />,
      entry: "/admin/settings/identification-types?page=99&size=10",
      setPages: () => {
        identificationTypesResult = {
          data: { items: [], total: 21, pages: 3 },
          isLoading: false,
          isError: false,
          refetch: refetchIdentificationTypes,
        };
      },
    },
    {
      name: "countries",
      component: <CountriesTable />,
      entry: "/admin/locations/countries?page=99&size=10",
      setPages: () => {
        countriesResult = {
          data: { items: [], total: 21, pages: 3 },
          isLoading: false,
          isError: false,
          refetch: refetchCountries,
        };
      },
    },
    {
      name: "states",
      component: <StatesTable />,
      entry: "/admin/locations/states?page=99&size=10",
      setPages: () => {
        statesResult = {
          data: { items: [], total: 21, pages: 3 },
          isLoading: false,
          isError: false,
          refetch: refetchStates,
        };
      },
    },
    {
      name: "cities",
      component: <CitiesTable />,
      entry: "/admin/locations/cities?page=99&size=10",
      setPages: () => {
        citiesResult = {
          data: { items: [], total: 21, pages: 3 },
          isLoading: false,
          isError: false,
          refetch: refetchCities,
        };
      },
    },
  ])("replaces an out-of-range $name page after rows load", async ({
    component,
    entry,
    setPages,
  }) => {
    setPages();
    await expectPageReplacement(component, entry, "page=3&size=10");
  });
});
