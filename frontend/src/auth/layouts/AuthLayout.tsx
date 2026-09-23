import { ArrowLeft } from "lucide-react";
import { Outlet, useLocation } from "react-router";

import { ThemeToggle } from "@/components/custom/ThemeToggle";
import { LANDING_URL } from "@/config/publicUrls";

// The top row matches the card width of the current screen so its edges line up.
const WIDE_AUTH_PATHS = ["/auth/register"];

const AuthLayout = () => {
  const { pathname } = useLocation();
  const rowWidth = WIDE_AUTH_PATHS.some((path) => pathname.startsWith(path))
    ? "max-w-4xl"
    : "max-w-md";

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
      <div className={`w-full ${rowWidth} mx-auto mb-4 flex items-center justify-between gap-2`}>
        <a
          href={LANDING_URL}
          className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver al inicio
        </a>
        <ThemeToggle />
      </div>
      <div className="w-full">
        <Outlet />
      </div>
    </div>
  );
};

export default AuthLayout;
