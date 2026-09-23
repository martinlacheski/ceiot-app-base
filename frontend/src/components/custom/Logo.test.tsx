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
  ] as const)("uses theme-aware brand icons and keeps %s navigation", (authStatus, href) => {
    vi.mocked(useAuthStore).mockReturnValue({ authStatus } as never);

    const { container } = render(<MemoryRouter><Logo /></MemoryRouter>);

    const link = screen.getByRole("link", { name: /monitoreo ambiental iot/i });
    expect(link).toHaveAttribute("href", href);
    expect(container.querySelector('img[src="/icon-light-512.png"]')).toHaveClass("dark:hidden");
    expect(container.querySelector('img[src="/icon-dark-512.png"]')).toHaveClass("hidden", "dark:block");
    expect(document.querySelectorAll('img[src*="dvem-logo"]')).toHaveLength(0);
    expect(link.firstElementChild).toHaveClass("size-16");
    expect(link.firstElementChild).not.toHaveClass("bg-white", "border-black/10");
  });

  it.each([
    ["small", "size-9"],
    ["large", "size-24"],
  ] as const)("renders the %s size without changing intrinsic dimensions", (size, expectedClass) => {
    vi.mocked(useAuthStore).mockReturnValue({ authStatus: "not-authenticated" } as never);
    const { container } = render(<MemoryRouter><Logo size={size} /></MemoryRouter>);

    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(2);
    expect(images[0].parentElement).toHaveClass(expectedClass);
    expect(images[0]).toHaveAttribute("width", "512");
    expect(images[0]).toHaveAttribute("height", "512");
    expect(images[1]).toHaveAttribute("width", "512");
    expect(images[1]).toHaveAttribute("height", "512");
  });
});
