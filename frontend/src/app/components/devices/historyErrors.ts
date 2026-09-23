export const isHistoryNotFound = (error: unknown) =>
  (error as { response?: { status?: number } } | null)?.response?.status === 404;
export const isHistoryForbidden = (error: unknown) =>
  (error as { response?: { status?: number } } | null)?.response?.status === 403;
