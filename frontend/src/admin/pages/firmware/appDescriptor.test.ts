import { describe, expect, it } from "vitest";

import { describeBuild, FIRMWARE_PROJECT, parseAppDescriptor, readFileHead } from "./appDescriptor";

const text = (value: string, width: number) => {
  const bytes = new Uint8Array(width);
  bytes.set(new TextEncoder().encode(value));
  return bytes;
};

/** A synthetic ESP app image head: header, segment header, then `esp_app_desc_t` at 32. */
const firmwareImage = (
  overrides: Partial<Record<"version" | "project" | "time" | "date" | "idf", string>> = {},
  magic = 0xabcd5432,
) => {
  const bytes = new Uint8Array(256);
  bytes[0] = 0xe9;
  new DataView(bytes.buffer).setUint32(32, magic, true);
  bytes.set(text(overrides.version ?? "1.2.0", 32), 48);
  bytes.set(text(overrides.project ?? "iot_device", 32), 80);
  bytes.set(text(overrides.time ?? "14:32:05", 16), 112);
  bytes.set(text(overrides.date ?? "Oct  6 2026", 16), 128);
  bytes.set(text(overrides.idf ?? "v5.4", 32), 144);
  return bytes.buffer;
};

describe("parseAppDescriptor", () => {
  it("reads the version, project, build time and IDF version", () => {
    expect(parseAppDescriptor(firmwareImage())).toEqual({
      version: "1.2.0",
      projectName: "iot_device",
      buildTime: "14:32:05",
      buildDate: "Oct  6 2026",
      idfVersion: "v5.4",
    });
    expect(FIRMWARE_PROJECT).toBe("iot_device");
  });

  it("returns null without the descriptor magic word", () => {
    expect(parseAppDescriptor(firmwareImage({}, 0x12345678))).toBeNull();
  });

  it("returns null for a buffer too short to hold the descriptor", () => {
    expect(parseAppDescriptor(new ArrayBuffer(100))).toBeNull();
  });
});

describe("describeBuild", () => {
  it("summarises project, build moment and IDF version in Spanish format", () => {
    expect(describeBuild(parseAppDescriptor(firmwareImage())!)).toBe(
      "iot_device · compilado 06/10/2026 14:32 · IDF v5.4",
    );
  });

  it("falls back to the raw date when it cannot be parsed", () => {
    expect(describeBuild(parseAppDescriptor(firmwareImage({ date: "weird" }))!)).toBe(
      "iot_device · compilado weird 14:32:05 · IDF v5.4",
    );
  });
});

describe("readFileHead", () => {
  it("reads only the first 256 bytes of the file", async () => {
    const file = new File([new Uint8Array(4096)], "iot_device.bin");
    expect((await readFileHead(file)).byteLength).toBe(256);
  });
});
