export const LOCALES = {
  ES: "es",
  PT_BR: "pt-br",
  EN: "en",
} as const;

export type Locale = (typeof LOCALES)[keyof typeof LOCALES];
export const landingLocales: Locale[] = [LOCALES.ES, LOCALES.PT_BR, LOCALES.EN];

interface LocaleLink { href: string; label: string }
interface NavLink { href: string; label: string }
interface Metric { name: string; unit: string; description: string }
interface Principle { title: string; description: string }

export interface ContactContent {
  eyebrow: string;
  heading: string;
  description: string;
  nameLabel: string;
  nameHelp: string;
  emailLabel: string;
  emailHelp: string;
  messageLabel: string;
  messageHelp: string;
  websiteLabel: string;
  submit: string;
  sending: string;
  success: string;
  validationError: string;
  throttled: string;
  unavailable: string;
  serviceError: string;
  genericError: string;
  networkError: string;
  noScript: string;
}

export interface MapContent {
  eyebrow: string;
  heading: string;
  description: string;
  missingApiKey: string;
  activeDeviceCountSingular: string;
  activeDeviceCount: string;
  closeLabel: string;
  language: string;
  region: string;
}

export interface LandingContent {
  locale: Locale;
  lang: "es" | "pt-BR" | "en";
  path: "/" | "/pt-br/" | "/en/";
  seo: { title: string; description: string; ogImage: string };
  nav: {
    links: NavLink[];
    contactLabel: string;
    tagline: string;
    localeLabel: string;
    locales: LocaleLink[];
    mobileMenuLabel: string;
    themeToggleLabel: string;
    themeLightLabel: string;
    themeDarkLabel: string;
  };
  hero: {
    badge: string;
    heading: string;
    description: string;
    primaryCta: string;
    appCta: string;
    iconAlt: string;
  };
  variables: { eyebrow: string; heading: string; description: string };
  metrics: Metric[];
  foundation: { eyebrow: string; heading: string; description: string; principles: Principle[] };
  map: MapContent;
  contact: ContactContent;
  whatsapp: { message: string; label: string };
  footer: { tagline: string; legalLine: string; links: LocaleLink[] };
}

const locales: LocaleLink[] = [
  { href: "/", label: "ES" },
  { href: "/pt-br/", label: "PT-BR" },
  { href: "/en/", label: "EN" },
];

const CONTENT: Record<Locale, LandingContent> = {
  es: {
    locale: LOCALES.ES,
    lang: "es",
    path: "/",
    seo: {
      title: "Monitoreo Ambiental IoT",
      description: "Una base para construir soluciones IoT que registren temperatura ambiente, humedad relativa y presión atmosférica.",
      ogImage: "/og-image.png",
    },
    nav: {
      links: [{ href: "#hero", label: "Inicio" }, { href: "#variables", label: "Variables" }, { href: "#base", label: "La base" }, { href: "#mapa", label: "Mapa" }],
      contactLabel: "Contacto",
      tagline: "Monitoreo Ambiental IoT",
      localeLabel: "Idioma",
      locales,
      mobileMenuLabel: "Abrir menú",
      themeToggleLabel: "Cambiar tema",
      themeLightLabel: "Usar tema claro",
      themeDarkLabel: "Usar tema oscuro",
    },
    hero: {
      badge: "Internet de las cosas para el ambiente",
      heading: "Monitoreo Ambiental IoT",
      description: "Explorá una base clara para construir sistemas que capturen, organicen y presenten variables ambientales. El alcance se centra en el modelo de información y no afirma telemetría en vivo ni instalaciones operativas.",
      primaryCta: "Conocer las variables",
      appCta: "Acceder al sistema",
      iconAlt: "Símbolo de monitoreo ambiental IoT",
    },
    variables: {
      eyebrow: "Variables ambientales",
      heading: "Tres magnitudes, unidades explícitas",
      description: "Cada variable conserva su unidad para que las lecturas futuras sean comprensibles y comparables.",
    },
    metrics: [
      { name: "Temperatura ambiente", unit: "°C", description: "Expresa la temperatura del aire en grados Celsius." },
      { name: "Humedad relativa", unit: "%", description: "Indica la proporción de humedad presente en el aire." },
      { name: "Presión atmosférica", unit: "hPa", description: "Representa la presión del aire en hectopascales." },
    ],
    foundation: {
      eyebrow: "Punto de partida",
      heading: "Una base para construir, no una promesa de operación",
      description: "La propuesta organiza conceptos de monitoreo ambiental para evolucionar de forma gradual, sin presentar datos de ejemplo como mediciones reales.",
      principles: [
        { title: "Datos con contexto", description: "Nombrá cada magnitud junto con su unidad y momento de observación." },
        { title: "Evolución gradual", description: "Incorporá captura, almacenamiento y visualización cuando el proyecto lo requiera." },
        { title: "Comunicación honesta", description: "Diferenciá siempre una demostración de una implementación operativa." },
      ],
    },
    map: {
      eyebrow: "Mapa",
      heading: "Establecimientos monitoreados",
      description: "Consultá las ubicaciones públicas de establecimientos que cuentan con dispositivos ambientales activos.",
      missingApiKey: "El mapa no está disponible porque falta configurar la clave del servicio de mapas.",
      activeDeviceCountSingular: "{count} dispositivo activo",
      activeDeviceCount: "{count} dispositivos activos",
      closeLabel: "Cerrar información",
      language: "es",
      region: "AR",
    },
    contact: {
      eyebrow: "Contacto",
      heading: "Contactanos",
      description: "Contanos qué necesitás saber sobre esta base de monitoreo ambiental IoT.",
      nameLabel: "Nombre",
      nameHelp: "Ingresá entre 4 y 120 caracteres.",
      emailLabel: "Correo electrónico",
      emailHelp: "Usaremos esta dirección para responderte.",
      messageLabel: "Mensaje",
      messageHelp: "Escribí entre 10 y 2000 caracteres.",
      websiteLabel: "Sitio web",
      submit: "Enviar mensaje",
      sending: "Enviando…",
      success: "Recibimos tu mensaje.",
      validationError: "Revisá los campos e intentá nuevamente.",
      throttled: "Recibimos demasiados intentos. Probá de nuevo más tarde.",
      unavailable: "El formulario no está disponible en este momento.",
      serviceError: "El servicio de contacto no está disponible en este momento.",
      genericError: "No pudimos procesar el mensaje. Intentá nuevamente.",
      networkError: "No pudimos conectarnos. Revisá tu conexión e intentá nuevamente.",
      noScript: "Necesitás habilitar JavaScript para usar este formulario.",
    },
    whatsapp: {
      message: "Hola, quiero consultar sobre el sistema de monitoreo ambiental IoT.",
      label: "Consultar por WhatsApp",
    },
    footer: {
      tagline: "Monitoreo Ambiental IoT",
      legalLine: "Monitoreo Ambiental IoT · Todos los derechos reservados.",
      links: [...locales, { href: "/privacidad/", label: "Privacidad" }],
    },
  },
  "pt-br": {
    locale: LOCALES.PT_BR,
    lang: "pt-BR",
    path: "/pt-br/",
    seo: {
      title: "Monitoramento Ambiental IoT",
      description: "Uma base para criar soluções IoT que registrem temperatura ambiente, umidade relativa e pressão atmosférica.",
      ogImage: "/og-image-pt.png",
    },
    nav: {
      links: [{ href: "#hero", label: "Início" }, { href: "#variables", label: "Variáveis" }, { href: "#base", label: "A base" }, { href: "#mapa", label: "Mapa" }],
      contactLabel: "Contato",
      tagline: "Monitoramento Ambiental IoT",
      localeLabel: "Idioma",
      locales,
      mobileMenuLabel: "Abrir menu",
      themeToggleLabel: "Alterar tema",
      themeLightLabel: "Usar tema claro",
      themeDarkLabel: "Usar tema escuro",
    },
    hero: {
      badge: "Internet das coisas para o ambiente",
      heading: "Monitoramento Ambiental IoT",
      description: "Conheça uma base clara para criar sistemas que capturem, organizem e apresentem variáveis ambientais. O escopo se concentra no modelo de informação e não afirma telemetria ao vivo nem instalações operacionais.",
      primaryCta: "Conhecer as variáveis",
      appCta: "Acessar o painel",
      iconAlt: "Símbolo de monitoramento ambiental IoT",
    },
    variables: { eyebrow: "Variáveis ambientais", heading: "Três grandezas, unidades explícitas", description: "Cada variável mantém sua unidade para que futuras leituras sejam compreensíveis e comparáveis." },
    metrics: [
      { name: "Temperatura ambiente", unit: "°C", description: "Expressa a temperatura do ar em graus Celsius." },
      { name: "Umidade relativa", unit: "%", description: "Indica a proporção de umidade presente no ar." },
      { name: "Pressão atmosférica", unit: "hPa", description: "Representa a pressão do ar em hectopascais." },
    ],
    foundation: {
      eyebrow: "Ponto de partida", heading: "Uma base para construir, não uma promessa de operação", description: "A proposta organiza conceitos de monitoramento ambiental para evoluir gradualmente, sem apresentar dados de exemplo como medições reais.",
      principles: [
        { title: "Dados com contexto", description: "Nomeie cada grandeza com sua unidade e momento de observação." },
        { title: "Evolução gradual", description: "Adicione captura, armazenamento e visualização quando o projeto exigir." },
        { title: "Comunicação honesta", description: "Diferencie sempre uma demonstração de uma implementação operacional." },
      ],
    },
    map: {
      eyebrow: "Mapa",
      heading: "Estabelecimentos monitorados",
      description: "Consulte as localizações públicas de estabelecimentos que possuem dispositivos ambientais ativos.",
      missingApiKey: "O mapa não está disponível porque falta configurar a chave do serviço de mapas.",
      activeDeviceCountSingular: "{count} dispositivo ativo",
      activeDeviceCount: "{count} dispositivos ativos",
      closeLabel: "Fechar informações",
      language: "pt-BR",
      region: "BR",
    },
    contact: {
      eyebrow: "Contato",
      heading: "Entre em contato",
      description: "Conte o que você precisa saber sobre esta base de monitoramento ambiental IoT.",
      nameLabel: "Nome",
      nameHelp: "Digite entre 4 e 120 caracteres.",
      emailLabel: "E-mail",
      emailHelp: "Usaremos este endereço para responder.",
      messageLabel: "Mensagem",
      messageHelp: "Escreva entre 10 e 2000 caracteres.",
      websiteLabel: "Site",
      submit: "Enviar mensagem",
      sending: "Enviando…",
      success: "Recebemos sua mensagem.",
      validationError: "Revise os campos e tente novamente.",
      throttled: "Recebemos muitas tentativas. Tente novamente mais tarde.",
      unavailable: "O formulário não está disponível no momento.",
      serviceError: "O serviço de contato não está disponível no momento.",
      genericError: "Não foi possível processar a mensagem. Tente novamente.",
      networkError: "Não foi possível conectar. Verifique sua conexão e tente novamente.",
      noScript: "Ative o JavaScript para usar este formulário.",
    },
    whatsapp: {
      message: "Olá, gostaria de saber mais sobre o sistema de monitoramento ambiental IoT.",
      label: "Falar pelo WhatsApp",
    },
    footer: {
      tagline: "Monitoramento Ambiental IoT",
      legalLine: "Monitoramento Ambiental IoT · Todos os direitos reservados.",
      links: [...locales, { href: "/privacidad/", label: "Privacidade" }],
    },
  },
  en: {
    locale: LOCALES.EN,
    lang: "en",
    path: "/en/",
    seo: {
      title: "IoT Environmental Monitoring",
      description: "A foundation for building IoT solutions that record ambient temperature, relative humidity, and atmospheric pressure.",
      ogImage: "/og-image-en.png",
    },
    nav: {
      links: [{ href: "#hero", label: "Home" }, { href: "#variables", label: "Variables" }, { href: "#base", label: "Foundation" }, { href: "#mapa", label: "Map" }],
      contactLabel: "Contact",
      tagline: "IoT Environmental Monitoring",
      localeLabel: "Language",
      locales,
      mobileMenuLabel: "Open menu",
      themeToggleLabel: "Change theme",
      themeLightLabel: "Use light theme",
      themeDarkLabel: "Use dark theme",
    },
    hero: {
      badge: "Internet of things for the environment",
      heading: "IoT Environmental Monitoring",
      description: "Explore a clear foundation for systems that capture, organize, and present environmental variables. The scope focuses on the information model and does not claim live telemetry or operational installations.",
      primaryCta: "Explore the variables",
      appCta: "Access dashboard",
      iconAlt: "IoT environmental monitoring symbol",
    },
    variables: { eyebrow: "Environmental variables", heading: "Three quantities, explicit units", description: "Each variable keeps its unit so future readings remain understandable and comparable." },
    metrics: [
      { name: "Ambient temperature", unit: "°C", description: "Expresses air temperature in degrees Celsius." },
      { name: "Relative humidity", unit: "%", description: "Indicates the proportion of moisture present in the air." },
      { name: "Atmospheric pressure", unit: "hPa", description: "Represents air pressure in hectopascals." },
    ],
    foundation: {
      eyebrow: "Starting point", heading: "A foundation to build on, not an operational promise", description: "The proposal organizes environmental monitoring concepts for gradual evolution without presenting example data as real measurements.",
      principles: [
        { title: "Contextual data", description: "Name every quantity with its unit and observation time." },
        { title: "Gradual evolution", description: "Add capture, storage, and visualization when the project requires them." },
        { title: "Honest communication", description: "Always distinguish a demonstration from an operational implementation." },
      ],
    },
    map: {
      eyebrow: "Map",
      heading: "Monitored establishments",
      description: "Explore the public locations of establishments with active environmental devices.",
      missingApiKey: "The map is unavailable because the map service key has not been configured.",
      activeDeviceCountSingular: "{count} active device",
      activeDeviceCount: "{count} active devices",
      closeLabel: "Close information",
      language: "en",
      region: "US",
    },
    contact: {
      eyebrow: "Contact",
      heading: "Contact us",
      description: "Tell us what you need to know about this IoT environmental monitoring foundation.",
      nameLabel: "Name",
      nameHelp: "Enter between 4 and 120 characters.",
      emailLabel: "Email",
      emailHelp: "We will use this address to reply.",
      messageLabel: "Message",
      messageHelp: "Write between 10 and 2000 characters.",
      websiteLabel: "Website",
      submit: "Send message",
      sending: "Sending…",
      success: "We received your message.",
      validationError: "Review the fields and try again.",
      throttled: "We received too many attempts. Try again later.",
      unavailable: "The form is currently unavailable.",
      serviceError: "The contact service is currently unavailable.",
      genericError: "We could not process the message. Try again.",
      networkError: "We could not connect. Check your connection and try again.",
      noScript: "Enable JavaScript to use this form.",
    },
    whatsapp: {
      message: "Hello, I would like to ask about the IoT environmental monitoring system.",
      label: "Ask on WhatsApp",
    },
    footer: {
      tagline: "IoT Environmental Monitoring",
      legalLine: "IoT Environmental Monitoring · All rights reserved.",
      links: [...locales, { href: "/privacidad/", label: "Privacy" }],
    },
  },
};

export function getLandingContent(locale: Locale): LandingContent {
  return CONTENT[locale];
}
