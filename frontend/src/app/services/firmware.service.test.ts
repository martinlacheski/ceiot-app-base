import { beforeEach, describe, expect, it, vi } from "vitest";
import { appApi } from "@/api/appApi";
import { firmwareService, getFirmwareErrorMessage } from "./firmware.service";

vi.mock("@/api/appApi", () => ({ appApi: { get: vi.fn(), post: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

const httpError = (status: number, detail?: unknown) => ({ response: { status, data: detail === undefined ? {} : { detail } } });

describe("firmwareService", () => {
  it("pages the catalog with snake_case params and lists active releases", async () => {
    vi.mocked(appApi.get).mockResolvedValue({ data: { items: [] } });
    await firmwareService.pageReleases({ page: 2, perPage: 20, search: "1.2", active: true, sort: "version:asc" });
    await firmwareService.listReleases({ active: true });
    expect(appApi.get).toHaveBeenNthCalledWith(1, "/firmware/releases/page", {
      params: { page: 2, per_page: 20, search: "1.2", active: true, sort: "version:asc" },
    });
    expect(appApi.get).toHaveBeenNthCalledWith(2, "/firmware/releases", { params: { active: true } });
  });

  it("uploads the image as multipart with notes and deactivate_previous", async () => {
    vi.mocked(appApi.post).mockResolvedValue({ data: { version: "1.2.0" } });
    const file = new File([new Uint8Array(4)], "iot_device.bin");
    await firmwareService.uploadRelease({ file, version: "1.2.0", notes: "build", deactivatePrevious: false });
    const [url, body] = vi.mocked(appApi.post).mock.calls[0];
    expect(url).toBe("/firmware/releases");
    const form = body as FormData;
    expect(form.get("file")).toBeInstanceOf(File);
    expect(form.get("version")).toBe("1.2.0");
    expect(form.get("notes")).toBe("build");
    expect(form.get("deactivate_previous")).toBe("false");
  });

  it("toggles a release, starts an update and lists a device's attempts", async () => {
    vi.mocked(appApi.post).mockResolvedValue({ data: {} });
    vi.mocked(appApi.get).mockResolvedValue({ data: [] });
    await firmwareService.setReleaseActive("r1", false);
    await firmwareService.setReleaseActive("r1", true);
    await firmwareService.startUpdate({ deviceId: "d1", releaseId: "r1" });
    await firmwareService.listUpdates("d1");
    expect(appApi.post).toHaveBeenNthCalledWith(1, "/firmware/releases/r1/deactivate");
    expect(appApi.post).toHaveBeenNthCalledWith(2, "/firmware/releases/r1/activate");
    expect(appApi.post).toHaveBeenNthCalledWith(3, "/firmware/updates", { deviceId: "d1", releaseId: "r1" });
    expect(appApi.get).toHaveBeenCalledWith("/firmware/devices/d1/updates");
  });
});

describe("getFirmwareErrorMessage", () => {
  it("prefers the backend's Spanish detail", () => {
    expect(getFirmwareErrorMessage(httpError(409, "El dispositivo está sin conexión"), "x")).toBe("El dispositivo está sin conexión");
  });

  it("maps statuses without a usable detail to clear messages", () => {
    expect(getFirmwareErrorMessage(httpError(409), "x")).toBe("El dispositivo está sin conexión o ya tiene una actualización en curso");
    expect(getFirmwareErrorMessage(httpError(422, [{ msg: "bad" }]), "x")).toBe("El archivo o los datos enviados no son válidos");
    expect(getFirmwareErrorMessage(httpError(503), "x")).toBe("El almacenamiento de firmware no está disponible. Intente más tarde.");
    expect(getFirmwareErrorMessage(httpError(403), "x")).toBe("Solo un administrador puede gestionar el firmware");
    expect(getFirmwareErrorMessage(httpError(500), "No se pudo subir el firmware")).toBe("No se pudo subir el firmware");
    expect(getFirmwareErrorMessage(new Error("network"), "fallback")).toBe("fallback");
  });
});
