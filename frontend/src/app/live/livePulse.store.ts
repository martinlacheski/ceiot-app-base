import { create } from "zustand";

interface LivePulseStatus {
  /** True while the pulse stream is open. */
  connected: boolean;
  setConnected: (connected: boolean) => void;
}

export const useLivePulseStatus = create<LivePulseStatus>()((set) => ({
  connected: false,
  setConnected: (connected) => set({ connected }),
}));
