import { useUser } from "@clerk/react";
import { getGetAccessMeQueryKey, useGetAccessMe } from "@workspace/api-client-react";

export function accessErrorStatus(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error && typeof error.status === "number") {
    return error.status;
  }
  return undefined;
}

export function retryAccessCheck(failureCount: number, error: unknown): boolean {
  const status = accessErrorStatus(error);
  // No automatic retries for admission failures, conflicts, or rate limits.
  return failureCount < 1 && (status === undefined || status >= 500);
}

export function useAccessStatus() {
  const { isLoaded, isSignedIn } = useUser();
  return useGetAccessMe({ query: {
    enabled: isLoaded && Boolean(isSignedIn),
    queryKey: getGetAccessMeQueryKey(),
    staleTime: 60_000,
    // Membership-less accounts wait for an explicit retry, not a bootstrap loop.
    // Admitted users still observe revocation; APIs enforce it immediately.
    refetchInterval: (query) => query.state.data?.membership ? 120_000 : false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: retryAccessCheck,
    retryDelay: 2_000,
  } });
}
