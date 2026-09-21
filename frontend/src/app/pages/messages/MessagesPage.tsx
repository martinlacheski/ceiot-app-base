import { PageHeader } from "@/app/components/PageHeader";

export const MessagesPage = () => {
  return (
    <div>
      <PageHeader title="Mensajes" subtitle="Centro de mensajes del sistema">
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