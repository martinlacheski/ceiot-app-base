import { LOCALES, type Locale } from "./content";

export const PRIVACY_PATHS: Record<Locale, string> = {
  [LOCALES.ES]: "/privacidad/",
  [LOCALES.PT_BR]: "/pt-br/privacidade/",
  [LOCALES.EN]: "/en/privacy/",
};

export interface PrivacyContent {
  path: string;
  title: string;
  seoTitle: string;
  description: string;
  eyebrow: string;
  updatedLabel: string;
  updatedDate: string;
  sections: Array<{ heading: string; paragraphs: string[] }>;
}

const PRIVACY: Record<Locale, PrivacyContent> = {
  es: {
    path: PRIVACY_PATHS.es,
    title: "Política de Privacidad",
    seoTitle: "Política de Privacidad | Monitoreo Ambiental IoT",
    description: "Cómo Monitoreo Ambiental IoT trata los datos personales y técnicos de sus usuarios.",
    eyebrow: "Legal",
    updatedLabel: "Última actualización",
    updatedDate: "23 de septiembre de 2026",
    sections: [
      { heading: "Quiénes somos y alcance", paragraphs: [
        "Monitoreo Ambiental IoT es un producto para administrar establecimientos, dispositivos conectados y mediciones ambientales. Esta política describe el tratamiento de datos personales y técnicos realizado por el sitio público y la aplicación.",
        "No se identifica aquí una sociedad, domicilio, CUIT ni correo electrónico porque el proyecto no define esos datos. Las consultas y solicitudes se reciben mediante el formulario de contacto del sitio.",
      ] },
      { heading: "Datos de cuenta e inicio de sesión", paragraphs: [
        "Para las cuentas registradas se almacenan nombre, apellido, correo electrónico, nombre de usuario y contraseña protegida mediante hashing. Según los datos completados, también pueden almacenarse tipo y número de identificación, domicilio, ciudad, teléfono y fecha de nacimiento.",
        "La cuenta también contiene permisos, fechas de creación y actualización y estados necesarios para administrar su activación, verificación y tipo de acceso.",
        "Cuando se utiliza el inicio de sesión con Google, el sistema recibe de Google el correo electrónico, el nombre y el apellido asociados al perfil autorizado. Google aplica sus propias condiciones y política de privacidad.",
      ] },
      { heading: "Establecimientos, dispositivos y mediciones", paragraphs: [
        "De cada establecimiento se gestionan su nombre, dirección, ubicación —que puede incluir coordenadas—, descripción, teléfono, ciudad, tipo y estado de actividad.",
        "Los dispositivos informan datos técnicos como número de serie, dirección MAC, dirección IP, red Wi-Fi y nivel de señal, versión de firmware, motivo de reinicio, coordenadas GPS y momentos de conexión. También se administran su nombre, modelo, lote, estado y establecimiento asociado.",
        "La telemetría puede incluir temperatura ambiente, humedad relativa, presión atmosférica, estado de alimentación, tiempo de actividad, memoria disponible, fecha y hora informada por el dispositivo, errores y otros metadatos contenidos en el reporte.",
      ] },
      { heading: "Invitaciones y acceso de invitados", paragraphs: [
        "Las personas propietarias pueden invitar a otras personas por correo electrónico. La invitación registra el correo, su estado, el alcance autorizado y la persona propietaria que la emitió.",
        "El acceso de una persona invitada queda limitado al establecimiento o dispositivo alcanzado por la invitación. Los controles de permisos y de base de datos separan la información de otros propietarios y alcances no autorizados.",
      ] },
      { heading: "Mapa público", paragraphs: [
        "El sitio muestra públicamente, para cada establecimiento incluido en el mapa, su nombre, ciudad, provincia o estado, país, coordenadas y cantidad de dispositivos activos.",
        "Esa publicación se realiza sin identificar a propietarios y sin exponer identificadores, números de serie, nombres de dispositivos ni su estado en línea o fuera de línea.",
      ] },
      { heading: "Formulario de contacto y WhatsApp", paragraphs: [
        "El formulario de contacto envía el nombre, el correo electrónico y el mensaje al servicio público del proyecto. El servicio entrega la consulta por correo electrónico al destinatario configurado para el sitio. La dirección IP de la solicitud se utiliza para limitar intentos abusivos.",
        "El enlace de WhatsApp abre ese servicio de terceros con un mensaje inicial. La información que la persona decida enviar allí queda sujeta a las condiciones y a la política de privacidad de WhatsApp.",
      ] },
      { heading: "Finalidades del tratamiento", paragraphs: [
        "Los datos se utilizan para crear y autenticar cuentas, administrar permisos, establecimientos y dispositivos, recibir y presentar mediciones ambientales, mantener el historial técnico y permitir el acceso limitado de personas invitadas.",
        "También se utilizan para responder consultas, enviar mensajes operativos relacionados con cuentas e invitaciones y publicar la proyección limitada del mapa descrita en esta política.",
      ] },
      { heading: "Terceros", paragraphs: [
        "El proyecto utiliza Google para el inicio de sesión opcional y para mostrar el mapa; WhatsApp cuando una persona abre voluntariamente el enlace de contacto; y un servicio de entrega de correo electrónico para consultas, verificaciones, recuperaciones de contraseña e invitaciones.",
        "Cada tercero trata la información conforme a sus propias condiciones. El proyecto no incorpora en esta política proveedores o herramientas de analítica que no estén implementados en el código revisado.",
      ] },
      { heading: "Almacenamiento en el navegador y sesión", paragraphs: [
        "El sitio guarda en localStorage únicamente la preferencia explícita de tema claro u oscuro, con la clave environmental-iot-theme.",
        "La aplicación utiliza una cookie refresh_token para renovar la sesión. La cookie es HttpOnly, usa SameSite=Lax, tiene una duración configurada y se marca Secure en producción. Se elimina al cerrar la sesión.",
      ] },
      { heading: "Seguridad", paragraphs: [
        "Las contraseñas se almacenan mediante hashing y se verifican sin conservarlas en texto plano. Los tokens de acceso y renovación tienen vencimiento.",
        "Los establecimientos, dispositivos, mediciones, operaciones e invitaciones están protegidos mediante permisos y seguridad por fila en la base de datos. Las políticas distinguen accesos de propietarios, miembros, invitados y procesos internos autorizados.",
      ] },
      { heading: "Derechos de las personas", paragraphs: [
        "De acuerdo con la Ley 25.326 de Protección de los Datos Personales de la República Argentina, las personas pueden solicitar el acceso, la rectificación, la actualización y la supresión de sus datos personales.",
        "Para ejercer estos derechos o realizar una consulta sobre esta política, se debe utilizar el formulario de contacto del sitio, indicando con claridad la solicitud para que pueda ser atendida.",
      ] },
      { heading: "Actualizaciones de esta política", paragraphs: [
        "Esta política puede actualizarse cuando cambien las funciones del producto o las normas aplicables. La versión vigente se publicará en esta página con su fecha de última actualización.",
      ] },
    ],
  },
  "pt-br": {
    path: PRIVACY_PATHS["pt-br"],
    title: "Política de Privacidade",
    seoTitle: "Política de Privacidade | Monitoramento Ambiental IoT",
    description: "Como o Monitoramento Ambiental IoT trata os dados pessoais e técnicos de seus usuários.",
    eyebrow: "Informações legais",
    updatedLabel: "Última atualização",
    updatedDate: "23 de setembro de 2026",
    sections: [
      { heading: "Quem somos e escopo", paragraphs: [
        "Monitoramento Ambiental IoT é um produto para administrar estabelecimentos, dispositivos conectados e medições ambientais. Esta política descreve o tratamento de dados pessoais e técnicos realizado pelo site público e pela aplicação.",
        "Não são identificados aqui uma empresa, endereço, CUIT nem endereço de e-mail porque o projeto não define esses dados. Consultas e solicitações são recebidas pelo formulário de contato do site.",
      ] },
      { heading: "Dados da conta e login", paragraphs: [
        "Para contas registradas, são armazenados nome, sobrenome, endereço de e-mail, nome de usuário e senha protegida por hashing. Conforme os dados preenchidos, também podem ser armazenados tipo e número de identificação, endereço, cidade, telefone e data de nascimento.",
        "A conta também contém permissões, datas de criação e atualização e estados necessários para administrar sua ativação, verificação e tipo de acesso.",
        "Quando o login com Google é utilizado, o sistema recebe do Google o endereço de e-mail, o nome e o sobrenome associados ao perfil autorizado. O Google aplica seus próprios termos e política de privacidade.",
      ] },
      { heading: "Estabelecimentos, dispositivos e medições", paragraphs: [
        "De cada estabelecimento, são administrados nome, endereço, localização —que pode incluir coordenadas—, descrição, telefone, cidade, tipo e status de atividade.",
        "Os dispositivos informam dados técnicos como número de série, endereço MAC, endereço IP, rede Wi-Fi e nível de sinal, versão do firmware, motivo de reinicialização, coordenadas GPS e momentos de conexão. Também são administrados nome, modelo, lote, status e estabelecimento associado.",
        "A telemetria pode incluir temperatura ambiente, umidade relativa, pressão atmosférica, estado da alimentação, tempo de atividade, memória disponível, data e hora informadas pelo dispositivo, erros e outros metadados contidos no relatório.",
      ] },
      { heading: "Convites e acesso de convidados", paragraphs: [
        "Os proprietários podem convidar outras pessoas por e-mail. O convite registra o endereço de e-mail, seu status, o escopo autorizado e o proprietário que o enviou.",
        "O acesso de uma pessoa convidada fica limitado ao estabelecimento ou dispositivo abrangido pelo convite. Os controles de permissões e do banco de dados separam as informações de outros proprietários e escopos não autorizados.",
      ] },
      { heading: "Mapa público", paragraphs: [
        "O site mostra publicamente, para cada estabelecimento incluído no mapa, seu nome, cidade, província ou estado, país, coordenadas e quantidade de dispositivos ativos.",
        "Essa publicação é feita sem identificar proprietários e sem expor identificadores, números de série, nomes de dispositivos nem seu status online ou offline.",
      ] },
      { heading: "Formulário de contato e WhatsApp", paragraphs: [
        "O formulário de contato envia o nome, o endereço de e-mail e a mensagem ao serviço público do projeto. O serviço entrega a consulta por e-mail ao destinatário configurado para o site. O endereço IP da solicitação é usado para limitar tentativas abusivas.",
        "O link do WhatsApp abre esse serviço de terceiros com uma mensagem inicial. As informações que a pessoa decidir enviar ali ficam sujeitas aos termos e à política de privacidade do WhatsApp.",
      ] },
      { heading: "Finalidades do tratamento", paragraphs: [
        "Os dados são usados para criar e autenticar contas, administrar permissões, estabelecimentos e dispositivos, receber e apresentar medições ambientais, manter o histórico técnico e permitir o acesso limitado de pessoas convidadas.",
        "Também são usados para responder a consultas, enviar mensagens operacionais relacionadas a contas e convites e publicar a projeção limitada do mapa descrita nesta política.",
      ] },
      { heading: "Terceiros", paragraphs: [
        "O projeto usa o Google para o login opcional e para exibir o mapa; o WhatsApp quando uma pessoa abre voluntariamente o link de contato; e um serviço de entrega de e-mail para consultas, verificações, recuperação de senhas e convites.",
        "Cada terceiro trata as informações conforme seus próprios termos. O projeto não inclui nesta política fornecedores ou ferramentas de análise que não estejam implementados no código revisado.",
      ] },
      { heading: "Armazenamento no navegador e sessão", paragraphs: [
        "O site armazena no localStorage apenas a preferência explícita pelo tema claro ou escuro, com a chave environmental-iot-theme.",
        "A aplicação usa um cookie refresh_token para renovar a sessão. O cookie é HttpOnly, usa SameSite=Lax, tem uma duração configurada e é marcado como Secure em produção. Ele é removido ao encerrar a sessão.",
      ] },
      { heading: "Segurança", paragraphs: [
        "As senhas são armazenadas por hashing e verificadas sem serem mantidas em texto simples. Os tokens de acesso e renovação têm prazo de validade.",
        "Estabelecimentos, dispositivos, medições, operações e convites são protegidos por permissões e segurança em nível de linha no banco de dados. As políticas distinguem acessos de proprietários, membros, convidados e processos internos autorizados.",
      ] },
      { heading: "Direitos das pessoas", paragraphs: [
        "De acordo com a Ley 25.326 de Protección de los Datos Personales da República Argentina, as pessoas podem solicitar acesso, retificação, atualização e exclusão de seus dados pessoais.",
        "Para exercer esses direitos ou fazer uma consulta sobre esta política, deve-se usar o formulário de contato do site, indicando claramente a solicitação para que ela possa ser atendida.",
      ] },
      { heading: "Atualizações desta política", paragraphs: [
        "Esta política pode ser atualizada quando as funcionalidades do produto ou as normas aplicáveis mudarem. A versão vigente será publicada nesta página com sua data de última atualização.",
      ] },
    ],
  },
  en: {
    path: PRIVACY_PATHS.en,
    title: "Privacy Policy",
    seoTitle: "Privacy Policy | IoT Environmental Monitoring",
    description: "How IoT Environmental Monitoring handles its users' personal and technical data.",
    eyebrow: "Legal",
    updatedLabel: "Last updated",
    updatedDate: "September 23, 2026",
    sections: [
      { heading: "Who we are and scope", paragraphs: [
        "IoT Environmental Monitoring is a product for managing establishments, connected devices, and environmental measurements. This policy describes the processing of personal and technical data by the public website and the application.",
        "No company, address, CUIT, or email address is identified here because the project does not define those details. Inquiries and requests are received through the website's contact form.",
      ] },
      { heading: "Account and sign-in data", paragraphs: [
        "For registered accounts, first name, last name, email address, username, and a password protected by hashing are stored. Depending on the information provided, identification type and number, address, city, phone number, and date of birth may also be stored.",
        "The account also contains permissions, creation and update dates, and statuses needed to manage its activation, verification, and access type.",
        "When Google sign-in is used, the system receives from Google the email address, first name, and last name associated with the authorized profile. Google's own terms and privacy policy apply.",
      ] },
      { heading: "Establishments, devices, and measurements", paragraphs: [
        "For each establishment, its name, address, location —which may include coordinates—, description, phone number, city, type, and activity status are managed.",
        "Devices report technical data such as serial number, MAC address, IP address, Wi-Fi network and signal strength, firmware version, restart reason, GPS coordinates, and connection times. Their name, model, batch, status, and associated establishment are also managed.",
        "Telemetry may include ambient temperature, relative humidity, atmospheric pressure, power status, uptime, available memory, the date and time reported by the device, errors, and other metadata contained in the report.",
      ] },
      { heading: "Invitations and guest access", paragraphs: [
        "Owners may invite other people by email. The invitation records the email address, its status, the authorized scope, and the owner who issued it.",
        "A guest's access is limited to the establishment or device covered by the invitation. Permission and database controls separate information belonging to other owners and unauthorized scopes.",
      ] },
      { heading: "Public map", paragraphs: [
        "For each establishment included on the map, the website publicly shows its name, city, province or state, country, coordinates, and number of active devices.",
        "This publication does not identify owners or expose identifiers, serial numbers, device names, or whether devices are online or offline.",
      ] },
      { heading: "Contact form and WhatsApp", paragraphs: [
        "The contact form sends the name, email address, and message to the project's public service. The service delivers the inquiry by email to the recipient configured for the website. The request's IP address is used to limit abusive attempts.",
        "The WhatsApp link opens that third-party service with an initial message. Information a person chooses to send there is subject to WhatsApp's terms and privacy policy.",
      ] },
      { heading: "Purposes of processing", paragraphs: [
        "Data is used to create and authenticate accounts; manage permissions, establishments, and devices; receive and present environmental measurements; maintain technical history; and allow limited guest access.",
        "It is also used to respond to inquiries, send operational messages related to accounts and invitations, and publish the limited map projection described in this policy.",
      ] },
      { heading: "Third parties", paragraphs: [
        "The project uses Google for optional sign-in and to display the map; WhatsApp when a person voluntarily opens the contact link; and an email delivery service for inquiries, verifications, password recoveries, and invitations.",
        "Each third party processes information under its own terms. This policy does not include analytics providers or tools that are not implemented in the reviewed code.",
      ] },
      { heading: "Browser storage and session", paragraphs: [
        "The website stores only the explicit light or dark theme preference in localStorage, under the key environmental-iot-theme.",
        "The application uses a refresh_token cookie to renew the session. The cookie is HttpOnly, uses SameSite=Lax, has a configured lifetime, and is marked Secure in production. It is removed on sign-out.",
      ] },
      { heading: "Security", paragraphs: [
        "Passwords are stored using hashing and verified without retaining them in plain text. Access and refresh tokens expire.",
        "Establishments, devices, measurements, operations, and invitations are protected by permissions and row-level security in the database. The policies distinguish access for owners, members, guests, and authorized internal processes.",
      ] },
      { heading: "Individual rights", paragraphs: [
        "Under the Ley 25.326 de Protección de los Datos Personales of the Argentine Republic, individuals may request access to, rectification, updating, and deletion of their personal data.",
        "To exercise these rights or inquire about this policy, use the website's contact form and clearly describe the request so it can be addressed.",
      ] },
      { heading: "Updates to this policy", paragraphs: [
        "This policy may be updated when product features or applicable rules change. The current version will be published on this page with its last-updated date.",
      ] },
    ],
  },
};

export function getPrivacyContent(locale: Locale): PrivacyContent {
  return PRIVACY[locale];
}
