import { Button } from "@/components/ui/button";

interface ListErrorStateProps {
  message: string;
  onRetry: () => void;
}

export function ListErrorState({ message, onRetry }: ListErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex min-h-40 flex-col items-center justify-center gap-3 text-center"
    >
      <p className="text-sm text-destructive">{message}</p>
      <Button type="button" variant="outline" onClick={onRetry}>
        Reintentar
      </Button>
    </div>
  );
}
