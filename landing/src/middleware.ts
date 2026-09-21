import { defineMiddleware } from "astro:middleware";

import { resolveLocaleRedirectPath } from "./i18n/routing";

export const onRequest = defineMiddleware((context, next) => {
  if (context.isPrerendered) {
    return next();
  }

  const { pathname } = context.url;

  if (pathname !== "/") {
    return next();
  }

  const redirectPath = resolveLocaleRedirectPath(context.request.headers.get("accept-language") ?? "");

  if (redirectPath !== null) {
    return context.redirect(redirectPath, 302);
  }

  return next();
});
