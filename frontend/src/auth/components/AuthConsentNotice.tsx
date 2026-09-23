import { PRIVACY_POLICY_URL } from "@/config/publicUrls";

export const AuthConsentNotice = () => (
  <div className="text-balance text-center text-xs text-muted-foreground [&_a]:underline [&_a]:underline-offset-4 hover:[&_a]:text-primary">
    Al continuar, aceptás la <a href={PRIVACY_POLICY_URL}>política de privacidad</a>.
  </div>
);
