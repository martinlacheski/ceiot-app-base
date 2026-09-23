import { ArrowLeft } from "lucide-react";
import { Outlet } from "react-router";

import { ThemeToggle } from "@/components/custom/ThemeToggle";
import { LANDING_URL } from "@/config/publicUrls";

const AuthLayout = () => {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
      <div className="w-full max-w-md mx-auto mb-4 flex items-center justify-between gap-2">
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
