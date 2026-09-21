import { create } from "zustand";

type ConfirmMode = "confirm" | "info";

interface ConfirmState {
  isOpen: boolean;
  message: string;
  mode: ConfirmMode;
  title: string;
  onConfirm: () => void | Promise<void>;
  openConfirm: (message: string, onConfirm: () => void | Promise<void>) => void;
  openInfo: (title: string, message: string) => void;
  closeConfirm: () => void;
}

export const useConfirmStore = create<ConfirmState>((set) => ({
  isOpen: false,
  message: "",
  mode: "confirm",
  title: "Confirmación",
  onConfirm: () => {},
  openConfirm: (message, onConfirm) =>
    set({
      isOpen: true,
      message,
      mode: "confirm",
      title: "Confirmación",
      onConfirm,
    }),
  openInfo: (title, message) =>
    set({
      isOpen: true,
      message,
      mode: "info",
      title,
      onConfirm: () => {},
    }),
  closeConfirm: () => set({ isOpen: false }),
}));

export const showConfirmDialog = (
  message: string,
  onConfirm: () => void | Promise<void>,
) => {
  useConfirmStore.getState().openConfirm(message, onConfirm);
};

export const showInfoDialog = (title: string, message: string) => {
  useConfirmStore.getState().openInfo(title, message);
};
