import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { retryAccessCheck, useAccessStatus } from "./use-access-status";

const state = vi.hoisted(() => ({ signedIn: true, query: vi.fn() }));
vi.mock("@clerk/react", () => ({
  useUser: () => ({ isLoaded: true, isSignedIn: state.signedIn }),
}));
vi.mock("@workspace/api-client-react", () => ({
  getGetAccessMeQueryKey: () => ["/api/access/me"],
  useGetAccessMe: (options: unknown) => { state.query(options); return {}; },
}));

describe("access-check reliability", () => {
  it("never automatically retries 429 or other authorization failures", () => {
    for (const status of [400, 401, 403, 409, 429]) expect(retryAccessCheck(0, { status })).toBe(false);
    expect(retryAccessCheck(0, { status: 503 })).toBe(true);
    expect(retryAccessCheck(1, { status: 503 })).toBe(false);
    expect(retryAccessCheck(0, new TypeError("network"))).toBe(true);
    expect(retryAccessCheck(1, new TypeError("network"))).toBe(false);
  });

  it("does not poll unadmitted accounts or refetch on focus; bounds admitted polling", () => {
    renderHook(() => useAccessStatus());
    const { query } = state.query.mock.lastCall![0];
    expect(query.staleTime).toBe(60_000);
    expect(query.refetchOnWindowFocus).toBe(false);
    expect(query.refetchOnReconnect).toBe(false);
    expect(query.retry).toBe(retryAccessCheck);
    expect(query.retryDelay).toBe(2_000);
    expect(query.refetchInterval({ state: { data: { membership: null } } })).toBe(false);
    expect(query.refetchInterval({ state: { data: undefined } })).toBe(false);
    expect(query.refetchInterval({ state: { data: { membership: { role: "owner" } } } })).toBe(120_000);
    expect(query.refetchInterval({ state: { data: { membership: { role: "member" } } } })).toBe(120_000);
  });

  it("does not request access before sign-in", () => {
    state.signedIn = false;
    renderHook(() => useAccessStatus());
    expect(state.query.mock.lastCall![0].query.enabled).toBe(false);
    state.signedIn = true;
  });
});
