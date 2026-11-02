import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MembershipGate } from "./membership-gate";
import { JoinPage, readInvitationFragment } from "./join-page";
import { InvitationsPage } from "./invitations-page";

const state = vi.hoisted(() => ({
  member: false, operator: false, error: false,
  redeem: vi.fn().mockResolvedValue({ member: true, isOperator: false }),
  graph: vi.fn(), retry: vi.fn(),
}));
vi.mock("@clerk/react", () => ({
  useUser: () => ({ user: { id: "test-user" }, isLoaded: true }),
  useClerk: () => ({ signOut: vi.fn() }), SignUp: () => <div>Sign-in identity form</div>,
}));
vi.mock("wouter", () => ({
  Link: ({ children, href, ...props }: React.PropsWithChildren<{ href: string }>) => <a href={href} {...props}>{children}</a>,
  Redirect: ({ to }: { to: string }) => <div data-testid="redirect">{to}</div>,
  useLocation: () => ["/invitations", vi.fn()],
}));
vi.mock("@workspace/api-client-react", () => ({
  useGetMembership: () => ({ data: { member: state.member, isOperator: state.operator }, isLoading: false, isError: state.error, refetch: state.retry }),
  useRedeemMembership: () => ({ mutateAsync: state.redeem, isPending: false, isError: false }),
  useGetMembershipInvitations: () => ({ data: { available: 5, successful: 0, invitations: [] }, isLoading: false }),
  useCreateMembershipInvitation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRevokeMembershipInvitation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useGetMembershipReferrals: () => { state.graph(); return { data: { relationships: [], nextCursor: null }, isLoading: false }; },
}));
const wrap = (child: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{child}</QueryClientProvider>);
afterEach(() => { cleanup(); vi.clearAllMocks(); state.member = false; state.operator = false; state.error = false; window.history.replaceState(null, "", "/"); });

describe("invitation membership UI", () => {
  it("does not mount protected content for an unaccepted identity", () => {
    wrap(<MembershipGate><div>Secret collection</div></MembershipGate>);
    expect(screen.queryByText("Secret collection")).toBeNull();
    expect(screen.getByTestId("redirect").textContent).toBe("/join");
  });
  it("preserves accepted membership and fails closed when checking fails", () => {
    state.member = true;
    const view = wrap(<MembershipGate><div>Secret collection</div></MembershipGate>);
    expect(screen.getByText("Secret collection")).toBeTruthy();
    view.unmount(); state.error = true;
    wrap(<MembershipGate><div>Secret collection</div></MembershipGate>);
    expect(screen.queryByText("Secret collection")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(state.retry).toHaveBeenCalled();
  });
  it("reads fragment codes, clears URL, and requires referral disclosure acknowledgement", async () => {
    const token = "a".repeat(43);
    window.history.replaceState(null, "", `/join#invite=${token}`);
    wrap(<JoinPage />);
    expect(readInvitationFragment(`#invite=${token}`)).toBe(token);
    expect(window.location.hash).toBe("");
    expect((screen.getByLabelText("Invitation code") as HTMLInputElement).value).toBe(token);
    const submit = screen.getByRole("button", { name: "Accept invitation" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(state.redeem).toHaveBeenCalledWith({ data: { token, relationshipAcknowledged: true } }));
    expect(screen.getByRole("link", { name: "Request access" }).getAttribute("href")).toContain("mailto:contact@ayamai.io");
  });
  it("never requests or displays internal relationships for an ordinary member", () => {
    wrap(<InvitationsPage />);
    expect(state.graph).not.toHaveBeenCalled();
    expect(screen.queryByText("Internal referral records")).toBeNull();
  });
  it("shows internal relationship controls only for authorized operators", () => {
    state.operator = true;
    wrap(<InvitationsPage />);
    expect(state.graph).toHaveBeenCalled();
    expect(screen.getByText("Internal referral records")).toBeTruthy();
  });
});
