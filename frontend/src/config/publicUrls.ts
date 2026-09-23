export const DEFAULT_APP_LOGIN_URL = "/auth/login";
export const DEFAULT_LANDING_URL = "/";

export function resolvePublicUrl(value: string | undefined, fallback: string): string {
  const trimmedValue = value?.trim();

  return trimmedValue && trimmedValue.length > 0 ? trimmedValue : fallback;
}

export const APP_LOGIN_URL = resolvePublicUrl(
  import.meta.env.VITE_APP_LOGIN_URL,
  DEFAULT_APP_LOGIN_URL,
);

export const LANDING_URL = resolvePublicUrl(
  import.meta.env.VITE_LANDING_URL,
  DEFAULT_LANDING_URL,
);

export function resolveLandingPageUrl(landingUrl: string, path: string): string {
  return `${landingUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export const PRIVACY_POLICY_URL = resolveLandingPageUrl(LANDING_URL, "privacidad/");
