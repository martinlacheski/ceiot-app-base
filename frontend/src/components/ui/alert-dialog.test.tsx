import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "./alert-dialog";

describe("AlertDialogContent", () => {
  it("stacks above normal dialogs and centers against the viewport", () => {
    render(
      <AlertDialog open onOpenChange={vi.fn()}>
        <AlertDialogContent>
          <AlertDialogTitle>Confirm action</AlertDialogTitle>
          <AlertDialogDescription>
            Verifies stacking and viewport centering.
          </AlertDialogDescription>
        </AlertDialogContent>
      </AlertDialog>,
    );

    const overlay = document.querySelector('[data-slot="alert-dialog-overlay"]');
    const alertDialog = screen.getByRole("alertdialog", {
      name: /confirm action/i,
    });

    expect(overlay).toHaveClass("z-[200]");
    expect(alertDialog).toHaveClass("z-[201]");
    expect(alertDialog).toHaveClass("fixed");
    expect(alertDialog).toHaveClass("left-[50vw]");
    expect(alertDialog).toHaveClass("top-[50dvh]");
    expect(alertDialog).toHaveClass("-translate-x-1/2");
    expect(alertDialog).toHaveClass("-translate-y-1/2");
    expect(alertDialog).toHaveClass("w-[calc(100vw-2rem)]");
    expect(alertDialog).toHaveClass("max-h-[90dvh]");
    expect(alertDialog).toHaveClass("overflow-y-auto");
  });
});
