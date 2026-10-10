import { MapPin } from "lucide-react";
import { Link } from "react-router";

import type { Environment } from "@/app/types/environment.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState, LoadingState, RefreshNotice } from "./OverviewStates";

const MAX_ROWS = 6;

interface EnvironmentsCardProps {
  environments: Environment[];
  total?: number;
  isPending: boolean;
  isError: boolean;
  hasData: boolean;
  isFetching: boolean;
  onRetry: () => void;
}

export function EnvironmentsCard({ environments, total, isPending, isError, hasData, isFetching, onRetry }: EnvironmentsCardProps) {
  const rows = environments.slice(0, MAX_ROWS);
  return (
    <Card role="region" aria-labelledby="overview-environments-title" className="gap-4">
      <CardHeader>
        <CardTitle id="overview-environments-title">Establecimientos</CardTitle>
        <CardDescription>Ubicaciones disponibles en tu cuenta</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isPending ? (
          <LoadingState label="establecimientos" />
        ) : isError && !hasData ? (
          <ErrorState label="establecimientos" onRetry={onRetry} />
        ) : (
          <>
            <RefreshNotice hasError={isError} isFetching={isFetching} />
            {rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No hay establecimientos disponibles.</p>
            ) : (
              <ul className="divide-y">
                {rows.map((environment) => (
                  <li key={environment.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{environment.name}</p>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="size-3 shrink-0" aria-hidden="true" />
                        <span className="truncate">
                          {environment.city?.name || environment.address || "Ubicación no informada"}
                        </span>
                      </p>
                    </div>
                    <Badge variant={environment.isActive ? "default" : "secondary"} className="shrink-0">
                      {environment.isActive ? "Activo" : "Inactivo"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center justify-between gap-2 border-t pt-3">
              <span className="text-xs text-muted-foreground tabular-nums">
                {rows.length > 0 ? `Mostrando ${rows.length} de ${total ?? environments.length}` : ""}
              </span>
              <Button asChild variant="ghost" size="sm">
                <Link to="/app/environments" aria-label="Ver todos los establecimientos">Ver todos</Link>
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
