export function resolveLocaleRedirectPath(acceptLanguage: string): "/pt-br/" | "/en/" | null {
  const preferredLanguages = acceptLanguage
    .split(",")
    .map((entry) => entry.trim().split(";")[0]?.toLowerCase())
    .filter((entry): entry is string => Boolean(entry));

  const firstMatch = preferredLanguages[0];

  if (firstMatch?.startsWith("pt")) {
    return "/pt-br/";
  }

  if (firstMatch?.startsWith("en")) {
    return "/en/";
  }

  return null;
}
