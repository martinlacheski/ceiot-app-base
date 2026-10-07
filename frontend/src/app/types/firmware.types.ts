/** Firmware catalog and OTA attempts (`/api/firmware`). Every device runs the same firmware. */

export interface FirmwareRelease {
  id: string;
  version: string;
  sha256: string;
  size: number;
  notes?: string | null;
  createdBy?: string | null;
  createdAt: string;
  active: boolean;
}

/** The upload answer: the release plus how many earlier releases it deactivated. */
export interface FirmwareUploadResult extends FirmwareRelease {
  deactivatedPrevious?: number;
}

export interface FirmwarePage {
  items: FirmwareRelease[];
  total: number;
  pages: number;
  page: number;
  perPage: number;
}

export interface FirmwarePageParams {
  page?: number;
  perPage?: number;
  search?: string;
  active?: boolean;
  /** `field:direction` over `createdAt` and `version`. */
  sort?: string;
}

export type FirmwareUpdateState =
  | "requested"
  | "accepted"
  | "rejected"
  | "downloading"
  | "verifying"
  | "installing"
  | "rebooting"
  | "succeeded"
  | "failed"
  | "rolled_back";

/** States after which the device sends nothing more for the attempt. */
export const FINAL_FIRMWARE_UPDATE_STATES: readonly FirmwareUpdateState[] = [
  "succeeded",
  "failed",
  "rolled_back",
  "rejected",
];

export const isFinalFirmwareUpdateState = (state: string): boolean =>
  (FINAL_FIRMWARE_UPDATE_STATES as readonly string[]).includes(state);

const POLL_MS = 2000;

/** Poll a device's attempts (newest first) while the newest can still change; stop once final. */
export const firmwareUpdatePollInterval = (updates: FirmwareUpdate[] | undefined): number | false => {
  const latest = updates?.[0];
  return latest && !isFinalFirmwareUpdateState(latest.state) ? POLL_MS : false;
};

export interface FirmwareUpdate {
  id: string;
  requestId: string;
  deviceId: string;
  deviceSerial: string;
  releaseId: string;
  state: FirmwareUpdateState;
  progress?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  runningVersion?: string | null;
  targetVersion: string;
  createdBy?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

export interface FirmwareUploadRequest {
  file: File;
  /** Omitted: the backend reads it from the image. */
  version?: string;
  notes?: string;
  /** Omitted: the backend deactivates the earlier releases (default on). */
  deactivatePrevious?: boolean;
}

export interface FirmwareStartRequest {
  deviceId: string;
  releaseId: string;
}
