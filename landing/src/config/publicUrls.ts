export function resolvePublicUrl(value: string | undefined): string {
  return value?.trim() ?? "";
}

export function resolveOptionalPublicUrl(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  if (!candidate) return undefined;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

export function resolveContactEndpoint(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  if (!candidate || candidate.includes("?") || candidate.includes("#")) return undefined;

  try {
    const url = new URL(candidate);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    return `${url.toString().replace(/\/+$/, "")}/public/contact`;
  } catch {
    return undefined;
  }
}

export function resolveWhatsAppNumber(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  return candidate && /^[1-9]\d{7,14}$/.test(candidate) ? candidate : undefined;
}

export const APP_LOGIN_URL = resolvePublicUrl(process.env.PUBLIC_APP_LOGIN_URL);
export const CONTACT_ENDPOINT = resolveContactEndpoint(process.env.PUBLIC_API_BASE_URL);
export const PUBLIC_SITE_URL = resolveOptionalPublicUrl(process.env.PUBLIC_SITE_URL);
export const WHATSAPP_NUMBER = resolveWhatsAppNumber(process.env.PUBLIC_WHATSAPP_NUMBER);
