import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

import { useAuthStore } from "@/auth/store/auth.store";
import { LANDING_URL } from "@/config/publicUrls";
import { Logo } from "./Logo";

vi.mock("@/auth/store/auth.store");

describe("Logo", () => {
  it.each([
    ["not-authenticated", LANDING_URL],
    ["authenticated", "/app"],
  ] as const)("uses the shared IoT icon and keeps %s navigation", (authStatus, href) => {
    vi.mocked(useAuthStore).mockReturnValue({ authStatus } as never);

    render(<MemoryRouter><Logo /></MemoryRouter>);

    const link = screen.getByRole("link", { name: /monitoreo ambiental iot/i });
    expect(link).toHaveAttribute("href", href);
    const image = screen.getByRole("img", { name: /monitoreo ambiental iot/i });
    expect(image).toHaveAttribute("src", "/iot.png");
    expect(image).toHaveAttribute("width", "512");
    expect(image).toHaveAttribute("height", "511");
    expect(document.querySelectorAll('img[src*="dvem-logo"]')).toHaveLength(0);
    expect(image.parentElement).toHaveClass("bg-white", "size-16");
  });

  it.each([
    ["small", "size-9"],
    ["large", "size-24"],
  ] as const)("renders the %s size without changing intrinsic dimensions", (size, expectedClass) => {
    vi.mocked(useAuthStore).mockReturnValue({ authStatus: "not-authenticated" } as never);
    render(<MemoryRouter><Logo size={size} /></MemoryRouter>);

    const image = screen.getByRole("img", { name: /monitoreo ambiental iot/i });
    expect(image.parentElement).toHaveClass(expectedClass, "bg-white");
    expect(image).toHaveAttribute("width", "512");
    expect(image).toHaveAttribute("height", "511");
  });
});
