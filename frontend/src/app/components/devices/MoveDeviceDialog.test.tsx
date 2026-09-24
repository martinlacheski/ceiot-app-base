import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Device } from "@/app/types/device.types";
import type { Environment } from "@/app/types/environment.types";

import { MoveDeviceDialog } from "./MoveDeviceDialog";

const { mutateAsyncMock, useEnvironmentsMock, environmentsState, authState } =
  vi.hoisted(() => ({
    mutateAsyncMock: vi.fn(),
    useEnvironmentsMock: vi.fn(),
    environmentsState: {
      isLoading: false,
      items: [] as Array<Partial<Environment>>,
      // Optional per-search-term result, to emulate the server-side filter.
      bySearch: null as null | ((search?: string) => Array<Partial<Environment>>),
    },
    authState: { user: { id: "owner-1", isAdmin: false } },
  }));

vi.mock("@/app/hooks/useDevices", () => ({
  useMoveDevice: () => ({
    mutateAsync: mutateAsyncMock,
  }),
}));

vi.mock("@/app/hooks/useEnvironments", () => ({
  useEnvironments: (filters: { search?: string }) => {
    useEnvironmentsMock(filters);
    return {
      isLoading: environmentsState.isLoading,
      data: {
        items: environmentsState.bySearch
          ? environmentsState.bySearch(filters.search)
          : environmentsState.items,
      },
    };
  },
}));

vi.mock("@/auth/store/auth.store", () => ({
  useAuthStore: (selector: (state: typeof authState) => unknown) =>
    selector(authState),
}));

vi.mock("@/components/custom/SearchableSelect", () => ({
  SearchableSelect: ({
    disabled,
    emptyMessage,
    isLoading,
    onChange,
    onSearchChange,
    options,
    placeholder,
    selectedLabel,
    shouldFilter,
    value,
  }: {
    disabled?: boolean;
    emptyMessage?: string;
    isLoading?: boolean;
    onChange: (value: string | undefined) => void;
    onSearchChange?: (term: string) => void;
    options: Array<{ label: string; value: string }>;
    placeholder?: string;
    selectedLabel?: string;
    shouldFilter?: boolean;
    value?: string;
  }) => (
    <div>
      <select
        aria-label={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value || undefined)}
        value={value ?? ""}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <input
        aria-label="search-input"
        onChange={(event) => onSearchChange?.(event.target.value)}
      />
      <span data-testid="select-selected-label">{selectedLabel}</span>
      <span data-testid="select-empty">{emptyMessage}</span>
      <span data-testid="select-loading">{String(!!isLoading)}</span>
      <span data-testid="select-filtering">{String(shouldFilter)}</span>
    </div>
  ),
}));

const device = {
  id: "device-1",
  serial: "IOT-0000-0001",
  name: "Sensor Norte",
  environmentId: "env-1",
  environment: { id: "env-1", name: "Casa Central", ownerId: "owner-1" },
} as Device;

const env = (overrides: Partial<Environment>): Partial<Environment> => ({
  isActive: true,
  ...overrides,
});

const seedEnvironments = () => {
  environmentsState.items = [
    env({ id: "env-1", name: "Casa Central", ownerId: "owner-1", ownerName: "Ana" }),
    env({ id: "env-2", name: "Sucursal Norte", ownerId: "owner-1", ownerName: "Ana" }),
    env({ id: "env-3", name: "Sucursal Sur", ownerId: "owner-1", ownerName: "Ana" }),
    env({ id: "env-9", name: "Local de Beto", ownerId: "owner-2", ownerName: "Beto" }),
  ];
};

const renderDialog = (
  props: Partial<React.ComponentProps<typeof MoveDeviceDialog>> = {},
) => {
  const onOpenChange = vi.fn();
  render(
    <MoveDeviceDialog
      device={device}
      open
      onOpenChange={onOpenChange}
      {...props}
    />,
  );
  return { onOpenChange };
};

const destinationSelect = () =>
  screen.getByRole("combobox", { name: /establecimiento destino/i });

const optionLabels = () =>
  within(destinationSelect())
    .getAllByRole("option")
    .map((option) => option.textContent)
    .filter((label) => !/seleccionar/i.test(label ?? ""));

describe("MoveDeviceDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    environmentsState.isLoading = false;
    environmentsState.bySearch = null;
    authState.user = { id: "owner-1", isAdmin: false };
    seedEnvironments();
    mutateAsyncMock.mockResolvedValue({});
  });

  it("offers only the establishments the user owns, without the current one", () => {
    renderDialog();

    expect(optionLabels()).toEqual(["Sucursal Norte", "Sucursal Sur"]);
  });

  it("lets an admin pick any establishment except the current one, showing the owner", () => {
    authState.user = { id: "admin-1", isAdmin: true };
    renderDialog();

    expect(optionLabels()).toEqual([
      "Sucursal Norte — Ana",
      "Sucursal Sur — Ana",
      "Local de Beto — Beto",
    ]);
  });

  it("hides the consequences until a destination is chosen", async () => {
    const user = userEvent.setup();
    renderDialog();

    expect(screen.queryByText(/qué va a pasar/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mover dispositivo" }),
    ).toBeDisabled();

    await user.selectOptions(destinationSelect(), "env-2");

    expect(screen.getByText(/qué va a pasar/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mover dispositivo" }),
    ).toBeEnabled();
  });

  it("explains that guests and history follow the move, without financial concepts", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.selectOptions(destinationSelect(), "env-2");

    expect(
      screen.getByText(/invitados propios de este dispositivo se quitarán/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/el historial ya registrado.*queda en Casa Central/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/comisi[oó]n/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/mercado pago/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/código qr/i)).not.toBeInTheDocument();
  });

  it("keeps visible spacing between the footer buttons", () => {
    renderDialog();

    const footer = screen.getByRole("button", { name: "Volver" })
      .parentElement as HTMLElement;
    expect(footer).toContainElement(
      screen.getByRole("button", { name: "Mover dispositivo" }),
    );
    // A `sm:gap-0` on the footer used to cancel the shared `gap-2` on desktop.
    expect(footer.className).not.toMatch(/gap-0/);
    expect(footer.className).toMatch(/\bgap-3\b/);
  });

  it("moves the device to the chosen establishment and closes the dialog", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();

    await user.selectOptions(destinationSelect(), "env-3");
    await user.click(screen.getByRole("button", { name: "Mover dispositivo" }));

    expect(mutateAsyncMock).toHaveBeenCalledWith({
      id: "device-1",
      data: { environmentId: "env-3" },
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("keeps the dialog open when the move fails", async () => {
    const user = userEvent.setup();
    mutateAsyncMock.mockRejectedValue(new Error("409"));
    const { onOpenChange } = renderDialog();

    await user.selectOptions(destinationSelect(), "env-2");
    await user.click(screen.getByRole("button", { name: "Mover dispositivo" }));

    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalled());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(
      screen.getByRole("button", { name: "Mover dispositivo" }),
    ).toBeEnabled();
  });

  it("shows an empty message and blocks confirming when there is nowhere to move to", () => {
    environmentsState.items = [
      env({ id: "env-1", name: "Casa Central", ownerId: "owner-1" }),
      env({ id: "env-9", name: "Local de Beto", ownerId: "owner-2" }),
    ];
    renderDialog();

    expect(
      screen.getByText(
        "No tenés otros establecimientos para mover este dispositivo",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mover dispositivo" }),
    ).toBeDisabled();
  });

  it("disables both buttons while the move is in flight", async () => {
    const user = userEvent.setup();
    mutateAsyncMock.mockReturnValue(new Promise(() => {}));
    renderDialog();

    await user.selectOptions(destinationSelect(), "env-2");
    await user.click(screen.getByRole("button", { name: "Mover dispositivo" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /moviendo/i }),
      ).toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: "Volver" })).toBeDisabled();
    expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
  });

  it("closes without moving when going back", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Volver" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mutateAsyncMock).not.toHaveBeenCalled();
  });

  describe("server-side destination search", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const typeSearch = (term: string) =>
      fireEvent.change(screen.getByLabelText("search-input"), {
        target: { value: term },
      });

    const lastFilters = () =>
      useEnvironmentsMock.mock.calls[
        useEnvironmentsMock.mock.calls.length - 1
      ][0];

    it("asks the server for the user's own active establishments, 50 at a time", () => {
      renderDialog();

      expect(lastFilters()).toEqual({
        page: 1,
        perPage: 50,
        isActive: true,
        sortBy: "name",
        sortOrder: "asc",
        ownerId: "owner-1",
        search: undefined,
      });
    });

    it("does not restrict by owner for an admin", () => {
      authState.user = { id: "admin-1", isAdmin: true };
      renderDialog();

      expect(lastFilters().ownerId).toBeUndefined();
    });

    it("sends the typed term only after the debounce and trimmed", () => {
      renderDialog();

      typeSearch("  sur ");
      expect(lastFilters().search).toBeUndefined();

      act(() => {
        vi.advanceTimersByTime(299);
      });
      expect(lastFilters().search).toBeUndefined();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(lastFilters().search).toBe("sur");
    });

    it("lists the results of the current term and turns local filtering off", () => {
      environmentsState.bySearch = (search) =>
        search
          ? [env({ id: "env-3", name: "Sucursal Sur", ownerId: "owner-1" })]
          : environmentsState.items;
      renderDialog();

      typeSearch("sur");
      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(optionLabels()).toEqual(["Sucursal Sur"]);
      expect(screen.getByTestId("select-filtering")).toHaveTextContent("false");
    });

    it("keeps the chosen destination when a later search no longer lists it", () => {
      environmentsState.bySearch = (search) =>
        search
          ? [env({ id: "env-3", name: "Sucursal Sur", ownerId: "owner-1" })]
          : environmentsState.items;
      renderDialog();

      fireEvent.change(destinationSelect(), { target: { value: "env-2" } });
      expect(screen.getByText(/qué va a pasar/i)).toBeInTheDocument();

      typeSearch("sur");
      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(optionLabels()).toEqual(["Sucursal Sur"]);
      expect(screen.getByTestId("select-selected-label")).toHaveTextContent(
        "Sucursal Norte",
      );
      expect(
        screen.getByRole("button", { name: "Mover dispositivo" }),
      ).toBeEnabled();
    });

    it("moves to the kept destination even if the search hides it", async () => {
      environmentsState.bySearch = (search) => (search ? [] : environmentsState.items);
      renderDialog();

      fireEvent.change(destinationSelect(), { target: { value: "env-2" } });
      typeSearch("zzz");
      act(() => {
        vi.advanceTimersByTime(300);
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Mover dispositivo" }));
      });

      expect(mutateAsyncMock).toHaveBeenCalledWith({
        id: "device-1",
        data: { environmentId: "env-2" },
      });
    });

    it("says nothing was found when a search term has no results and keeps the select", () => {
      environmentsState.bySearch = (search) => (search ? [] : environmentsState.items);
      renderDialog();

      typeSearch("zzz");
      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(destinationSelect()).toBeInTheDocument();
      expect(screen.getByTestId("select-empty")).toHaveTextContent(
        "No se encontraron establecimientos",
      );
      expect(
        screen.queryByText(/no tenés otros establecimientos/i),
      ).not.toBeInTheDocument();
    });

    it("reports the loading state to the select while fetching a new term", () => {
      renderDialog();
      expect(screen.getByTestId("select-loading")).toHaveTextContent("false");

      environmentsState.isLoading = true;
      typeSearch("su");
      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(screen.getByTestId("select-loading")).toHaveTextContent("true");
      expect(destinationSelect()).toBeEnabled();
    });
  });
});
