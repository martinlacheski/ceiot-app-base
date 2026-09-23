import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { getDevicesForMapAction } from "@/app/actions/device-map.actions";
import { PageHeader } from "@/app/components/PageHeader";
import { MapContainer } from "@/components/dashboard/map/MapContainer";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function MapPage() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { data: devices = [] } = useQuery({
    queryKey: ["devices", "map"],
    queryFn: getDevicesForMapAction,
  });
  const filteredDevices = devices.filter(
    (device) => statusFilter === "all" || device.status === statusFilter,
  );
  const onlineCount = devices.filter(
    (device) => device.status === "online",
  ).length;
  const offlineCount = devices.length - onlineCount;

  return (
    <PageHeader
      title="Mapa"
      subtitle="Visualización geográfica de todos los dispositivos"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="gap-2 py-3">
          <CardHeader>
            <CardTitle className="text-sm font-medium">En línea</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {onlineCount}
            </div>
          </CardContent>
        </Card>
        <Card className="gap-2 py-3">
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              Fuera de línea
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {offlineCount}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card className="overflow-hidden">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>Mapa</CardTitle>
                <CardDescription>
                  Seleccioná un marcador para ver el dispositivo
                </CardDescription>
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los estados</SelectItem>
                  <SelectItem value="online">Solo en línea</SelectItem>
                  <SelectItem value="offline">Solo fuera de línea</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="px-6">
            <MapContainer devices={filteredDevices} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Dispositivos
            </CardTitle>
            <CardDescription>{filteredDevices.length} visibles</CardDescription>
          </CardHeader>
          <CardContent className="max-h-[600px] space-y-3 overflow-y-auto">
            {filteredDevices.map((device) => (
              <Link
                key={device.id}
                to={`/app/devices/${device.id}`}
                state={{ from: "/app/map" }}
              >
                <div className="rounded-lg border p-3 transition-colors hover:bg-muted/50">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{device.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {device.location.address} · {device.location.city}
                      </p>
                    </div>
                    <Badge
                      variant="secondary"
                      className={
                        device.status === "online"
                          ? "bg-green-100 text-green-800"
                          : "bg-red-100 text-red-800"
                      }
                    >
                      {device.status === "online"
                        ? "En línea"
                        : "Fuera de línea"}
                    </Badge>
                  </div>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </PageHeader>
  );
}
