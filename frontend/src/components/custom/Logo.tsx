import { Link } from "react-router";

import { useAuthStore } from "@/auth/store/auth.store";
import { LANDING_URL } from "@/config/publicUrls";
import { cn } from "@/lib/utils";

interface Props {
  subtitle?: string;
  size?: "default" | "small" | "large";
  className?: string;
}

export const Logo = ({ size = "default", className }: Props) => {
  const { authStatus } = useAuthStore();
  const isAuthenticated = authStatus === "authenticated";
  const sizeClassName = {
    small: "size-9",
    default: "size-16",
    large: "size-24",
  }[size];
  const logoContent = (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        sizeClassName,
      )}
    >
      <img
        src="/icon-light-512.png"
        alt="Monitoreo Ambiental IoT"
        width={512}
        height={512}
        className="h-full w-full object-contain dark:hidden"
      />
      <img
        src="/icon-dark-512.png"
        alt=""
        aria-hidden="true"
        width={512}
        height={512}
        className="hidden h-full w-full object-contain dark:block"
      />
    </span>
  );
  const linkClassName = cn("flex items-center whitespace-nowrap", className);

  if (!isAuthenticated) {
    return (
      <a
        href={LANDING_URL}
        className={linkClassName}
        aria-label="Monitoreo Ambiental IoT"
      >
        {logoContent}
      </a>
    );
  }

  return (
    <Link
      to="/app"
      className={linkClassName}
      aria-label="Monitoreo Ambiental IoT"
    >
      {logoContent}
    </Link>
  );
};
