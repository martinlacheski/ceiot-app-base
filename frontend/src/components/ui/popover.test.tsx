import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Popover, PopoverContent, PopoverTrigger } from "./popover";

const TestPopover = ({ portalled }: { portalled?: boolean }) => (
  <Popover>
    <PopoverTrigger>Open</PopoverTrigger>
    <PopoverContent portalled={portalled}>Content</PopoverContent>
  </Popover>
);

describe("PopoverContent portalling", () => {
  it("keeps the default portal isolated under document.body", () => {
    const host = document.createElement("div");
    document.body.append(host);
    render(<TestPopover />, { container: host });

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const content = screen.getByText("Content").closest('[data-slot="popover-content"]');
    expect(content?.parentElement?.parentElement).toBe(document.body);
    expect(host).not.toContainElement(content as HTMLElement);
    host.remove();
  });

  it("renders content in place when portalled is false", () => {
    const host = document.createElement("div");
    document.body.append(host);
    render(<TestPopover portalled={false} />, { container: host });

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(host).toContainElement(screen.getByText("Content"));
    host.remove();
  });
});
