// The app's QueryClient for imperative helpers (openUserActions) that run outside React render.
// App.tsx does not export its client, so the groups components register it while mounted.
import { useQueryClient, type QueryClient } from '@tanstack/react-query';

let current: QueryClient | null = null;

/** Call from any mounted groups component; keeps the module ref pointing at the app client. */
export function useRegisterQueryClient(): QueryClient {
  const qc = useQueryClient();
  current = qc;
  return qc;
}

export function queryClient(): QueryClient | null {
  return current;
}
