import type { ReactNode } from "react";

interface ListToolbarLayoutProps {
  search: ReactNode;
  primaryActions: ReactNode;
  secondaryActions?: ReactNode;
}

export function ListToolbarLayout({
  search,
  primaryActions,
  secondaryActions,
}: ListToolbarLayoutProps) {
  return (
    <div
      className="flex w-full min-w-0 max-w-full flex-col gap-4 md:flex-row md:items-center"
      data-testid="list-toolbar"
    >
      <div
        className="w-full min-w-0 md:max-w-sm md:flex-1 [&_[data-list-toolbar-search-control]]:min-h-11"
        data-testid="list-toolbar-search"
      >
        {search}
      </div>
      <div
        className="flex min-w-0 max-w-full flex-wrap items-center gap-2 [&_button]:min-h-11"
        data-testid="list-toolbar-actions"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {primaryActions}
        </div>
        {secondaryActions ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {secondaryActions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
