import { describe, expect, it } from "vitest";

import { formatFileSize } from "./fileSize";

describe("formatFileSize", () => {
  it("formats sizes in megabytes with a decimal comma", () => {
    expect(formatFileSize(2_147_024)).toBe("2,1 MB");
    expect(formatFileSize(512)).toBe("0,0 MB");
    expect(formatFileSize(4_194_304)).toBe("4,2 MB");
  });
});
