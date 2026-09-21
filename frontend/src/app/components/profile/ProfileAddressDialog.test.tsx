import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ProfileAddressDialog } from "./ProfileAddressDialog";

vi.mock("@vis.gl/react-google-maps", () => ({
  AdvancedMarker: () => <div>marker</div>,
  APIProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ControlPosition: { TOP_CENTER: "TOP_CENTER" },
  Map: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MapControl: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useMapsLibrary: () => null,
}));

vi.mock("@/components/custom/GooglePlaceAutocomplete", () => ({
  GooglePlaceAutocomplete: () => <div>autocomplete</div>,
}));

describe("ProfileAddressDialog", () => {
  it("confirma la dirección inicial sin tocar el formulario hasta aceptar", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <ProfileAddressDialog
        open={true}
        onOpenChange={onOpenChange}
        initialAddress="Av. Siempre Viva 742"
        initialCityId="city-1"
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText("Ingresar dirección")).toBeInTheDocument();
    expect(screen.getByText("Av. Siempre Viva 742")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /confirmar dirección/i }),
    );

    expect(onConfirm).toHaveBeenCalledWith({
      address: "Av. Siempre Viva 742",
      cityId: "city-1",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
