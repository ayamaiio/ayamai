import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JoinPage } from "./join";

const state = vi.hoisted(() => ({
  signedIn: true, large: false, role: null as "owner" | "member" | null,
  loading: false, error: null as { status: number } | null,
  navigate: vi.fn(), validate: vi.fn(), accept: vi.fn(), refetch: vi.fn(),
}));
vi.mock("@clerk/react", () => ({
  useUser: () => ({ isLoaded: true, isSignedIn: state.signedIn, user: {
    emailAddresses: [{ emailAddress: "founder@example.invalid", verification: { status: "verified" } }],
  } }),
  useClerk: () => ({ signOut: vi.fn() }),
}));
vi.mock("@/hooks/use-access-status", () => ({
  useAccessStatus: () => ({
    isLoading: state.loading, isSuccess: !state.loading && !state.error,
    isError: !!state.error, error: state.error, refetch: state.refetch,
    data: state.loading || state.error ? undefined : { membership: state.role ? { role: state.role } : null },
  }),
  accessErrorStatus: (error: { status?: number } | null) => error?.status,
}));
vi.mock("@/lib/use-large-screen", () => ({ isLargeScreen: () => state.large }));
vi.mock("@/social/app-nav", () => ({ Brand: () => <span>ayamai</span> }));
vi.mock("wouter", () => ({
  useLocation: () => ["/join", state.navigate],
  Link: ({ children, href }: React.PropsWithChildren<{ href: string }>) => <a href={href}>{children}</a>,
}));
vi.mock("@workspace/api-client-react", () => ({
  getGetAccessMeQueryKey: () => ["/api/access/me"],
  useValidateAccessInvite: () => ({ mutate: state.validate, data: { valid: true, email: "founder@example.invalid" } }),
  useAcceptAccessInvite: () => ({ mutate: state.accept }),
}));

const mount = () => render(<QueryClientProvider client={new QueryClient()}><JoinPage /></QueryClientProvider>);
beforeEach(() => {
  state.signedIn = true; state.role = null; state.error = null; state.loading = false; state.large = false;
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/join");
});

describe("active join route", () => {
  it.each(["owner", "member"] as const)("routes an admitted %s into mobile product without an invitation", async role => {
    state.role = role;
    mount();
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("/feed", { replace: true }));
    expect(screen.queryByText("Invitation link not found")).toBeNull();
    expect(state.accept).not.toHaveBeenCalled();
  });

  it("routes an admitted owner into the desktop video page", async () => {
    state.role = "owner"; state.large = true;
    mount();
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("/videos", { replace: true }));
  });

  it("checks signed-in admission before displaying missing-token instructions", () => {
    state.loading = true;
    mount();
    expect(screen.getByText("Checking library access")).toBeTruthy();
    expect(screen.queryByText("Invitation link not found")).toBeNull();
  });

  it("does not mistake a 429 for missing membership", () => {
    state.error = { status: 429 };
    mount();
    expect(screen.getByText("Access checks temporarily paused")).toBeTruthy();
    expect(screen.queryByText("Invitation link not found")).toBeNull();
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it("still requires a token for an unadmitted account", () => {
    mount();
    expect(screen.getByText("Invitation link not found")).toBeTruthy();
    expect(state.navigate).not.toHaveBeenCalled();
    expect(state.accept).not.toHaveBeenCalled();
  });

  it("still validates and accepts an email-bound token for an unadmitted account", async () => {
    window.history.replaceState(null, "", `/join#${"a".repeat(43)}`);
    mount();
    await waitFor(() => expect(state.validate).toHaveBeenCalledWith({ data: { token: "a".repeat(43) } }));
    await waitFor(() => expect(state.accept).toHaveBeenCalled());
    expect(state.navigate).not.toHaveBeenCalled();
  });
});
