import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { FeedPage } from "./feed-page";

const api = vi.hoisted(() => ({ saved: vi.fn(), uid: "viewer-a", observers: [] as IntersectionObserverCallback[] }));
vi.mock("@clerk/react", () => ({ useUser: () => ({ user: { id: api.uid } }) }));
vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("./app-nav", () => ({ AppNav: () => null }));
vi.mock("./social-tile", () => ({
  SocialTile: ({ post, active, savedOnly }: { post: { id: string }; active: boolean; savedOnly: boolean }) =>
    <div data-testid={`tile-${post.id}`} data-active={active} data-saved={savedOnly} />,
}));
vi.mock("@workspace/api-client-react", () => ({
  getGetLabelCatalogQueryKey: () => ["/api/social/labels"],
  useGetLabelCatalog: () => ({ data: { items: [] }, isLoading: false, isError: false }),
  getGetSavedSocialPostsQueryKey: (params: unknown) => ["/api/social/saved", params],
  getGetWatchSettingsQueryKey: () => ["/api/watch/settings"],
  getSavedSocialPosts: (...args: unknown[]) => api.saved(...args),
  useGetWatchSettings: () => ({ data: { autoplayEnabled: true, dataSaverEnabled: false }, isLoading: false }),
  useUpdateWatchSettings: () => ({ mutate: vi.fn() }),
}));

beforeEach(() => {
  api.uid = "viewer-a";
  api.observers = [];
  api.saved.mockReset();
  HTMLElement.prototype.scrollTo = vi.fn();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { api.observers.push(callback); }
    observe() {}
    disconnect() {}
  });
});

function view(client: QueryClient) {
  return <QueryClientProvider client={client}><FeedPage saved /></QueryClientProvider>;
}
const clientForTest = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

it("uses the saved cursor endpoint, fullscreen tiles and media filters", async () => {
  api.saved.mockImplementation(async ({ cursor, type }) => type === "image"
    ? { items: [], nextCursor: null, hasMore: false }
    : cursor ? { items: [{ id: "two" }], nextCursor: null, hasMore: false }
      : { items: [{ id: "one" }], nextCursor: "cursor-one", hasMore: true });
  const client = clientForTest();
  render(view(client));
  const tile = await screen.findByTestId("tile-one");
  expect(tile.getAttribute("data-saved")).toBe("true");
  expect(tile.getAttribute("data-active")).toBe("true");
  const wrapper = tile.closest("[data-index]")!;
  api.observers.at(-1)!([{ target: wrapper, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
  await screen.findByTestId("tile-two");
  expect(api.saved).toHaveBeenCalledWith({ type: "all", cursor: "cursor-one" });
  expect(screen.getByText("You’re all caught up.")).toBeTruthy();
  fireEvent.click(screen.getByTestId("button-feed-type-image"));
  await screen.findByText("No saved posts here yet.");
  expect(api.saved).toHaveBeenCalledWith({ type: "image" });
});

it("does not reuse another account's saved data", async () => {
  api.saved.mockImplementation(async () => ({ items: [{ id: api.uid }], nextCursor: null, hasMore: false }));
  const client = clientForTest();
  const mounted = render(view(client));
  await screen.findByTestId("tile-viewer-a");
  api.uid = "viewer-b";
  mounted.rerender(view(client));
  await screen.findByTestId("tile-viewer-b");
  expect(screen.queryByTestId("tile-viewer-a")).toBeNull();
});

it("does not poll eight loaded pages into the Saved endpoint's 90-request-per-minute limit", async () => {
  const pages = Array.from({ length: 8 }, (_, index) => ({
    items: Array.from({ length: 24 }, (_, item) => ({ id: `post-${index}-${item}` })),
    hasMore: index < 7,
    nextCursor: index < 7 ? `cursor-${index + 1}` : null,
    nextPage: index < 7 ? `cursor-${index + 1}` : null,
  }));
  api.saved.mockImplementation(async ({ cursor }) => pages[cursor ? Number(cursor.split("-")[1]) : 0]);
  const client = clientForTest();
  const queryKey = ["/api/social/saved", { type: "all" }, api.uid];
  client.setQueryData(queryKey, { pages, pageParams: [0, ...Array.from({ length: 7 }, (_, i) => `cursor-${i + 1}`)] });
  const mounted = render(view(client));
  await waitFor(() => expect(api.saved).toHaveBeenCalledTimes(8));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(screen.getByTestId("tile-post-0-0")).toBeTruthy();
  vi.useFakeTimers();
  try {
    // The old five-second infinite-query interval would make 96+ calls here.
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(api.saved).toHaveBeenCalledTimes(8);
    expect(screen.queryByTestId("button-retry-feed")).toBeNull();
    expect(screen.getByTestId("tile-post-0-0")).toBeTruthy();
  } finally {
    mounted.unmount();
    client.clear();
    vi.useRealTimers();
  }
});

it("shows retry on errors and loads a private empty state after retry", async () => {
  api.saved.mockRejectedValueOnce(new Error("Offline")).mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
  const client = clientForTest();
  render(view(client));
  fireEvent.click(await screen.findByTestId("button-retry-feed"));
  await waitFor(() => expect(screen.getByText("No saved posts here yet.")).toBeTruthy());
});
