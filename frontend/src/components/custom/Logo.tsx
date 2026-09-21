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
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-xl border border-black/10 bg-white p-1.5", sizeClassName)}>
      <img src="/iot.png" alt="Monitoreo Ambiental IoT" width={512} height={511} className="h-full w-full object-contain" />
    </span>
  );
  const linkClassName = cn("flex items-center whitespace-nowrap", className);

  if (!isAuthenticated) {
    return <a href={LANDING_URL} className={linkClassName}>{logoContent}</a>;
  }

  return <Link to="/app" className={linkClassName}>{logoContent}</Link>;
};
