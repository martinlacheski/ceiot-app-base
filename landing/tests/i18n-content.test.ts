import { describe, expect, it } from "vitest";

import { getLandingContent, landingLocales, LOCALES } from "../src/i18n/content";

describe("generic environmental landing content", () => {
  it("localizes the environmental monitoring proposition in all supported locales", () => {
    const expectations = [
      {
        locale: LOCALES.ES,
        lang: "es",
        path: "/",
        title: "Monitoreo Ambiental IoT",
        cta: "Acceder al sistema",
        whatsappMessage: "Hola, quiero consultar sobre el sistema de monitoreo ambiental IoT.",
        whatsappLabel: "Consultar por WhatsApp",
        navContact: "Contacto",
        contactHeading: "Contactanos",
        contactSubmit: "Enviar mensaje",
        contactSuccess: "Recibimos tu mensaje.",
      },
      {
        locale: LOCALES.EN,
        lang: "en",
        path: "/en/",
        title: "IoT Environmental Monitoring",
        cta: "Access dashboard",
        whatsappMessage: "Hello, I would like to ask about the IoT environmental monitoring system.",
        whatsappLabel: "Ask on WhatsApp",
        navContact: "Contact",
        contactHeading: "Contact us",
        contactSubmit: "Send message",
        contactSuccess: "We received your message.",
      },
      {
        locale: LOCALES.PT_BR,
        lang: "pt-BR",
        path: "/pt-br/",
        title: "Monitoramento Ambiental IoT",
        cta: "Acessar o painel",
        whatsappMessage: "Olá, gostaria de saber mais sobre o sistema de monitoramento ambiental IoT.",
        whatsappLabel: "Falar pelo WhatsApp",
        navContact: "Contato",
        contactHeading: "Entre em contato",
        contactSubmit: "Enviar mensagem",
        contactSuccess: "Recebemos sua mensagem.",
      },
    ];

    expect(landingLocales).toEqual([LOCALES.ES, LOCALES.PT_BR, LOCALES.EN]);

    for (const expected of expectations) {
      const content = getLandingContent(expected.locale);
      expect(content).toMatchObject({ locale: expected.locale, lang: expected.lang, path: expected.path });
      expect(content.hero.heading).toBe(expected.title);
      expect(content.hero.appCta).toBe(expected.cta);
      expect(content.nav.contactLabel).toBe(expected.navContact);
      expect(content.nav.links).not.toContainEqual({ href: "#contact", label: expected.navContact });
      expect(content).toHaveProperty("whatsapp");
      expect((content as typeof content & { whatsapp: { message: string; label: string } }).whatsapp).toEqual({
        message: expected.whatsappMessage,
        label: expected.whatsappLabel,
      });
      expect(content.contact).toMatchObject({
        heading: expected.contactHeading,
        submit: expected.contactSubmit,
        success: expected.contactSuccess,
      });
      expect(content.contact.success).not.toMatch(/sent|enviado|enviamos|email|correo|e-mail/i);
      expect(content.metrics.map((metric) => metric.unit)).toEqual(["°C", "%", "hPa"]);
      expect(content.metrics).toHaveLength(3);
      expect(content.nav.locales.map((item) => item.href)).toEqual(["/", "/pt-br/", "/en/"]);
    }
  });

  it("contains no legacy company, payment, customer, or live-service claims", () => {
    for (const locale of landingLocales) {
      const serialized = JSON.stringify(getLandingContent(locale));
      expect(serialized).not.toMatch(/DVEM|Matemetal|Mercado Pago|vending|dispens|admin@|wa\.me/i);
      expect(serialized).not.toMatch(/tiempo real|real[- ]time|tempo real|clientes|customers|clientes instalados/i);
    }
  });
});
