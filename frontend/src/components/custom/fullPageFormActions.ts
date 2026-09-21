export const FULL_PAGE_FORM_BACK_LABEL = "Volver";
export const FULL_PAGE_FORM_SAVE_LABEL = "Guardar Cambios";
export type FullPageFormMode = "create" | "edit";
export const getFullPageFormPrimaryLabel = (
  mode: FullPageFormMode,
  createLabel: string,
) => (mode === "create" ? createLabel : FULL_PAGE_FORM_SAVE_LABEL);
export const FULL_PAGE_FORM_ACTIONS_CLASS =
  "grid grid-cols-2 gap-3 sm:flex sm:justify-end";
export const FULL_PAGE_FORM_ACTION_BUTTON_CLASS = "h-11 w-full sm:w-auto";
