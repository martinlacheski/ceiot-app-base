import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const images: Array<{ onload: (() => void) | null; onerror: (() => void) | null; src: string }> = [];
const drawImage = vi.fn();
const toDataURL = vi.fn(() => "data:image/png;base64,prepared");

beforeEach(() => {
  vi.resetModules();
  images.length = 0;
  drawImage.mockClear();
  toDataURL.mockReset().mockReturnValue("data:image/png;base64,prepared");
  vi.stubGlobal("Image", class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 743;
    naturalHeight = 144;
    src = "";
    constructor() { images.push(this); }
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(toDataURL);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("loadReportBranding", () => {
  it("shares in-flight preparation and caches the original assets as PNGs", async () => {
    const { loadReportBranding } = await import("./report-branding");
    const first = loadReportBranding();
    const second = loadReportBranding();
    expect(first).toBe(second);
    expect(images.map((image) => image.src)).toEqual(["/report/report-logo-left.png", "/report/report-logo-right.png"]);
    images.forEach((image) => image.onload?.());
    const result = await first;
    expect(result.logo).toEqual({ data: "data:image/png;base64,prepared", width: 743, height: 144 });
    expect(result.right.data).toBe(result.logo.data);
    expect(drawImage).toHaveBeenCalledTimes(2);
    expect(toDataURL).toHaveBeenCalledWith("image/png");
    expect(await loadReportBranding()).toBe(result);
    expect(images).toHaveLength(2);
  });

  it("rejects an unavailable image and resets the cache so the next export can retry", async () => {
    const { loadReportBranding } = await import("./report-branding");
    const failed = expect(loadReportBranding()).rejects.toThrow("No se pudo cargar");
    images[0].onerror?.();
    images[1].onload?.();
    await failed;
    const retried = loadReportBranding();
    expect(images).toHaveLength(4);
    images.slice(2).forEach((image) => image.onload?.());
    await expect(retried).resolves.toHaveProperty("logo.data");
  });

  it("rejects PNG conversion failures instead of caching a partial header", async () => {
    const { loadReportBranding } = await import("./report-branding");
    toDataURL.mockImplementationOnce(() => { throw new Error("canvas unavailable"); });
    const result = expect(loadReportBranding()).rejects.toThrow("canvas unavailable");
    images.forEach((image) => image.onload?.());
    await result;
    const retried = loadReportBranding();
    images.slice(2).forEach((image) => image.onload?.());
    await expect(retried).resolves.toHaveProperty("right.data");
  });

  it("rejects stalled asset loads instead of leaving export completion pending", async () => {
    vi.useFakeTimers();
    const { loadReportBranding } = await import("./report-branding");
    const result = expect(loadReportBranding()).rejects.toThrow("No se pudo cargar");
    await vi.advanceTimersByTimeAsync(15000);
    await result;
  });
});
