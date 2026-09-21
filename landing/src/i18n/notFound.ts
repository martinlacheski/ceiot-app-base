import { LOCALES, type Locale } from "./content";

export interface NotFoundContent {
  title: string;
  description: string;
  eyebrow: string;
  heading: string;
  copy: string;
  imageAlt: string;
  primaryCta: string;
}

const NOT_FOUND_BY_LOCALE: Record<Locale, NotFoundContent> = {
  [LOCALES.ES]: {
    title: "Página no encontrada | Monitoreo Ambiental IoT",
    description: "La página solicitada no está disponible. Volvé al inicio para continuar.",
    eyebrow: "Error 404",
    heading: "Página no encontrada",
    copy: "La dirección que intentaste abrir no está disponible o fue modificada.",
    imageAlt: "Símbolo de monitoreo ambiental IoT",
    primaryCta: "Volver al inicio",
  },
  [LOCALES.PT_BR]: {
    title: "Página não encontrada | Monitoramento Ambiental IoT",
    description: "A página solicitada não está disponível. Volte ao início para continuar.",
    eyebrow: "Erro 404",
    heading: "Página não encontrada",
    copy: "O endereço que você tentou acessar não está disponível ou foi alterado.",
    imageAlt: "Símbolo de monitoramento ambiental IoT",
    primaryCta: "Voltar ao início",
  },
  [LOCALES.EN]: {
    title: "Page not found | IoT Environmental Monitoring",
    description: "The requested page is unavailable. Return home to continue.",
    eyebrow: "Error 404",
    heading: "Page not found",
    copy: "The address you tried to open is unavailable or has changed.",
    imageAlt: "IoT environmental monitoring symbol",
    primaryCta: "Return home",
  },
};

export function getNotFoundContent(locale: Locale): NotFoundContent {
  return NOT_FOUND_BY_LOCALE[locale];
}
