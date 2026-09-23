import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ListErrorState } from "./ListErrorState";

describe("ListErrorState", () => {
  it("shows the supplied message and retries on request", async () => {
    const onRetry = vi.fn();

    render(
      <ListErrorState
        message="No se pudieron cargar los países."
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText("No se pudieron cargar los países.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
