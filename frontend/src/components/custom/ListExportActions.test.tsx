import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ListExportActions } from "./ListExportActions";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));

describe("ListExportActions", () => {
  beforeEach(() => toastError.mockReset());

  it("renders the standard right-aligned row with Excel and PDF buttons", () => {
    render(<ListExportActions onExport={vi.fn()} />);
    const row = screen.getByTestId("list-export-actions");
    expect(row).toHaveClass("flex", "justify-end");
    expect(row.firstElementChild).toHaveClass("flex", "gap-2");
    expect(screen.getByRole("button", { name: "Excel" })).toHaveClass("gap-2");
    expect(screen.getByRole("button", { name: "PDF" })).toBeVisible();
  });

  it("calls onExport with the chosen format", async () => {
    const onExport = vi.fn().mockResolvedValue(undefined);
    render(<ListExportActions onExport={onExport} />);
    await userEvent.click(screen.getByRole("button", { name: "Excel" }));
    await userEvent.click(screen.getByRole("button", { name: "PDF" }));
    expect(onExport.mock.calls).toEqual([["excel"], ["pdf"]]);
  });

  it("disables both buttons while exporting", async () => {
    let finish: () => void = () => {};
    const onExport = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(<ListExportActions onExport={onExport} />);
    await userEvent.click(screen.getByRole("button", { name: "Excel" }));
    expect(screen.getByRole("button", { name: "Excel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "PDF" })).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.getByRole("button", { name: "PDF" })).toBeEnabled());
  });

  it("shows an error toast and re-enables the buttons when the export fails", async () => {
    render(<ListExportActions onExport={vi.fn().mockRejectedValue(new Error("x"))} />);
    await userEvent.click(screen.getByRole("button", { name: "PDF" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Error al generar el reporte"));
    expect(screen.getByRole("button", { name: "Excel" })).toBeEnabled();
  });

  it("honors the disabled prop", () => {
    render(<ListExportActions onExport={vi.fn()} disabled />);
    expect(screen.getByRole("button", { name: "Excel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "PDF" })).toBeDisabled();
  });
});
