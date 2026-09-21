import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "./ConfirmDialog";
import {
  showConfirmDialog,
  showInfoDialog,
  useConfirmStore,
} from "@/store/confirm.store";

describe("ConfirmDialog", () => {
  beforeEach(() => {
    useConfirmStore.setState({
      isOpen: false,
      message: "",
      mode: "confirm",
      title: "Confirmación",
      onConfirm: () => {},
    });
  });

  it("renders informational content with one neutral acknowledgement", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmDialog />);

    act(() => {
      showInfoDialog("Configuración de Google", "Follow the setup guide");
    });

    expect(screen.getByRole("heading", { name: "Configuración de Google" })).toBeInTheDocument();
    expect(screen.getByText("Follow the setup guide")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Si" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "No" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Entendido" }));

    expect(screen.queryByText("Follow the setup guide")).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("resets informational mode when a normal two-argument confirm opens", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmDialog />);

    act(() => {
      showInfoDialog("Información", "Informational message");
      showConfirmDialog("Normal confirmation", onConfirm);
    });

    expect(screen.getByRole("heading", { name: "Confirmación" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Si" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("keeps a chained confirm open when the first confirm callback opens it", async () => {
    const user = userEvent.setup();
    const secondConfirm = vi.fn();

    render(<ConfirmDialog />);

    await act(async () => {
      showConfirmDialog("First confirm", async () => {
        showConfirmDialog("Second confirm", secondConfirm);
      });
    });

    await user.click(screen.getByRole("button", { name: "Si" }));

    await waitFor(() => {
      expect(screen.getByText("Second confirm")).toBeInTheDocument();
    });

    expect(screen.getByRole("heading", { name: "Confirmación" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No" })).toBeInTheDocument();
    expect(screen.queryByText("First confirm")).not.toBeInTheDocument();
    expect(secondConfirm).not.toHaveBeenCalled();
  });
});
