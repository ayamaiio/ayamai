import type { ReactNode } from "react";
import { useUser } from "@clerk/react";
import { Redirect } from "wouter";
import { useGetMembership } from "@workspace/api-client-react";
import { Button } from "@workspace/ayamai-design-system/components/ui/button";
import { Skeleton } from "@workspace/ayamai-design-system/components/ui/skeleton";

export function useMembership() {
  const { user } = useUser();
  return useGetMembership({ query: { enabled: !!user, queryKey: ["/api/membership", user?.id], staleTime: 30_000, retry: false } });
}

export function MembershipGate({ children }: { children: ReactNode }) {
  const membership = useMembership();
  if (membership.isLoading) return <main className="grid min-h-[100dvh] place-items-center" aria-busy="true"><Skeleton className="h-8 w-8 rounded-full" /><span className="sr-only">Checking membership</span></main>;
  if (membership.isError) return <main className="grid min-h-[100dvh] place-items-center px-4"><div className="space-y-4 text-center"><h1 className="text-xl font-semibold">Couldn’t check your invitation.</h1><p className="text-sm text-muted-foreground">Your collection has not changed.</p><Button onClick={() => void membership.refetch()}>Try again</Button></div></main>;
  return membership.data?.member ? <>{children}</> : <Redirect to="/join" />;
}
