import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getConnectionStatusLabel } from "@/utils/status-labels";

interface DevicePresenceBadgeProps
  extends Omit<ComponentProps<typeof Badge>, "children" | "variant"> {
  brokerConnected: boolean | null;
}

export function DevicePresenceBadge({
  brokerConnected,
  className,
  ...props
}: DevicePresenceBadgeProps) {
  if (brokerConnected === null) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200",
          className,
        )}
        {...props}
      >
        No disponible
      </Badge>
    );
  }

  return (
    <Badge
      variant={brokerConnected ? "default" : "secondary"}
      className={className}
      {...props}
    >
      {getConnectionStatusLabel(brokerConnected ? "online" : "offline")}
    </Badge>
  );
}
