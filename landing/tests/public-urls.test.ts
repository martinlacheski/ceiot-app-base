import { describe, expect, it } from "vitest";

import * as publicUrls from "../src/config/publicUrls";

const { resolveContactEndpoint, resolveOptionalPublicUrl, resolvePublicUrl } = publicUrls;
const resolveWhatsAppNumber = (publicUrls as typeof publicUrls & {
  resolveWhatsAppNumber: (value: string | undefined) => string | undefined;
}).resolveWhatsAppNumber;

describe("landing public urls", () => {
  it("trims configured public URLs", () => {
    expect(resolvePublicUrl(" http://localhost:15173/auth/login ")).toBe("http://localhost:15173/auth/login");
    expect(resolveOptionalPublicUrl(" https://environment.example.test/ ")).toBe("https://environment.example.test");
  });

  it("does not invent a production host when configuration is absent", () => {
    expect(resolvePublicUrl(undefined)).toBe("");
    expect(resolveOptionalPublicUrl("   ")).toBeUndefined();
  });

  it("rejects non-http public site origins", () => {
    expect(resolveOptionalPublicUrl("javascript:alert(1)")).toBeUndefined();
    expect(resolveOptionalPublicUrl("/relative")).toBeUndefined();
  });

  it("resolves the configured full API prefix to the contact endpoint", () => {
    expect(resolveContactEndpoint(" https://api.example.test/custom/v2/ ")).toBe(
      "https://api.example.test/custom/v2/public/contact",
    );
    expect(resolveContactEndpoint("http://localhost:18000/api")).toBe(
      "http://localhost:18000/api/public/contact",
    );
    expect(resolveContactEndpoint("https://api.example.test/api%3Fpart/%23section/")).toBe(
      "https://api.example.test/api%3Fpart/%23section/public/contact",
    );
  });

  it.each([
    ["missing", undefined],
    ["relative", "/api"],
    ["non-http", "javascript:alert(1)"],
    ["credentials", "https://user:secret@api.example.test/api"],
    ["bare query", "https://api.example.test/api?"],
    ["query", "https://api.example.test/api?tenant=x"],
    ["bare hash", "https://api.example.test/api#"],
    ["hash", "https://api.example.test/api#fragment"],
    ["invalid", "not a url"],
  ])("rejects %s API configuration instead of inventing an endpoint", (_case, value) => {
    expect(resolveContactEndpoint(value)).toBeUndefined();
  });

  it("accepts only trimmed international WhatsApp digits", () => {
    expect(resolveWhatsAppNumber(" 5491112345678 ")).toBe("5491112345678");
    expect(resolveWhatsAppNumber("12345678")).toBe("12345678");
    expect(resolveWhatsAppNumber("123456789012345")).toBe("123456789012345");
  });

  it.each([
    ["missing", undefined],
    ["blank", "   "],
    ["leading zero", "012345678"],
    ["punctuation", "+54 9 11 1234-5678"],
    ["too short", "1234567"],
    ["too long", "1234567890123456"],
    ["injection-like", "12345678?text=hello"],
  ])("rejects %s WhatsApp configuration", (_case, value) => {
    expect(resolveWhatsAppNumber(value)).toBeUndefined();
  });
});
