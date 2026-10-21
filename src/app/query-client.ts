import { QueryClient } from "@tanstack/react-query";

/** The app's query cache; exported for code outside React (network operations). */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});
