import { describe, expect, it } from "vitest";

import {
  FULL_PAGE_FORM_ACTION_BUTTON_CLASS,
  FULL_PAGE_FORM_ACTIONS_CLASS,
  FULL_PAGE_FORM_BACK_LABEL,
  FULL_PAGE_FORM_SAVE_LABEL,
  getFullPageFormPrimaryLabel,
} from "./fullPageFormActions";

describe("full-page form action contract", () => {
  it("defines the exact action labels", () => {
    expect(FULL_PAGE_FORM_BACK_LABEL).toBe("Volver");
    expect(FULL_PAGE_FORM_SAVE_LABEL).toBe("Guardar Cambios");
  });

  it("defines equal mobile actions and intrinsic desktop actions", () => {
    expect(FULL_PAGE_FORM_ACTIONS_CLASS).toBe(
      "grid grid-cols-2 gap-3 sm:flex sm:justify-end",
    );
    expect(FULL_PAGE_FORM_ACTION_BUTTON_CLASS).toBe("h-11 w-full sm:w-auto");
  });

  it("preserves the surface-owned create label", () => {
    expect(getFullPageFormPrimaryLabel("create", "Crear Condición Fiscal")).toBe(
      "Crear Condición Fiscal",
    );
  });

  it("uses the shared edit label independently of the create label", () => {
    expect(getFullPageFormPrimaryLabel("edit", "Crear Usuario")).toBe(
      "Guardar Cambios",
    );
  });
});
