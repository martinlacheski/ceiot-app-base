import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { LiveIndicator } from "./LiveIndicator";
import { useLivePulseStatus } from "./livePulse.store";

describe("LiveIndicator", () => {
  beforeEach(() => useLivePulseStatus.setState({ connected: false }));

  it("renders nothing while the pulse stream is not connected", () => {
    const { container } = render(<LiveIndicator />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a discreet 'En vivo' marker when connected", () => {
    render(<LiveIndicator />);
    act(() => useLivePulseStatus.setState({ connected: true }));
    expect(screen.getByText("En vivo")).toBeInTheDocument();
    expect(screen.getByTitle("Actualizando en tiempo real")).toBeInTheDocument();
  });
});
