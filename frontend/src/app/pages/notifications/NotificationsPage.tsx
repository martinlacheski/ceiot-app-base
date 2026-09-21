import { PageHeader } from "@/app/components/PageHeader";

export const NotificationsPage = () => {
  return (
    <div>
      <PageHeader
        title="Notificaciones"
        subtitle="Centro de notificaciones del sistema"
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-[400px] flex-col items-center justify-center space-y-4">
            <p className="text-muted-foreground">
              Esta funcionalidad estará disponible próximamente
            </p>
          </div>
        </div>
      </PageHeader>
    </div>
  );
}