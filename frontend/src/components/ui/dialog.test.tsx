import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";

describe("DialogContent", () => {
  it("centers against the viewport instead of an overflowing layout box", () => {
    render(
      <Dialog open onOpenChange={vi.fn()}>
        <DialogContent>
          <DialogTitle>Viewport centered dialog</DialogTitle>
          <DialogDescription>
            Verifies that centering uses viewport units.
          </DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    const dialog = screen.getByRole("dialog", {
      name: /viewport centered dialog/i,
    });

    expect(dialog).toHaveClass("fixed");
    expect(dialog).toHaveClass("left-[50vw]");
    expect(dialog).toHaveClass("top-[50dvh]");
    expect(dialog).toHaveClass("-translate-x-1/2");
    expect(dialog).toHaveClass("-translate-y-1/2");
    expect(dialog).toHaveClass("w-[calc(100vw-2rem)]");
    expect(dialog).toHaveClass("max-h-[90dvh]");
  });
});
