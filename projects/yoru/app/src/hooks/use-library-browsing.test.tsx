import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readLibraryBookmark, useLibraryBrowsing } from "./use-library-browsing";

const api = vi.hoisted(() => vi.fn());
vi.mock("@workspace/api-client-react", () => ({ listMedia: api }));
const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const key = (account: string) => `afterframe:library:v1:${account}`;
const filters = { search: "", kind: "all", favorites: false, collectionFilter: "", uncategorized: false };
const library = Array.from({ length: 2400 }, (_, index) => ({ id: id(index) }));
let missing = false;
let client: QueryClient;

function Harness({ account }: { account: string }) {
  const state = useLibraryBrowsing(account);
  return <>
    <input aria-label="Search" value={state.filters.search} onChange={(e) => state.changeFilter("search", e.target.value)} />
    <button onClick={() => state.changeFilter("kind", "video")}>Videos</button>
    <button onClick={() => state.changeFilter("favorites", true)}>Saved</button>
    <button onClick={() => state.changeFilter("collectionFilter", "Trips")}>Trips</button>
    <button onClick={() => state.changeFilter("uncategorized", true)}>Unsorted</button>
    <button onClick={state.clearFilters}>Clear</button>
    <button onClick={state.capture}>Leave</button>
    <button onClick={() => void state.list.fetchNextPage()}>Next</button>
    <button onClick={state.loadEarlier}>Earlier</button>
    <div ref={state.gridRef}>{state.items.map((item) => <div key={item.id} data-media-id={item.id}>{item.id}</div>)}</div>
    <span data-testid="ready">{String(state.list.isSuccess)}</span>
  </>;
}
function mount(account = "a") {
  return render(<QueryClientProvider client={client}><Harness key={account} account={account} /></QueryClientProvider>);
}
beforeEach(() => {
  localStorage.clear();
  missing = false;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: 0 });
  vi.spyOn(window, "scrollTo").mockImplementation((options: ScrollToOptions | number) => {
    if (typeof options === "object") Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: options.top ?? 0 });
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    const cards = Array.from(this.parentElement?.querySelectorAll("[data-media-id]") ?? []);
    const top = 240 + Math.floor(cards.indexOf(this) / 2) * 140 - window.scrollY;
    return { top, bottom: top + 136, left: 0, right: 100, height: 136, width: 100, x: 0, y: top, toJSON() {} };
  });
  api.mockReset().mockImplementation(async (params) => {
    const rank = params.anchorId ? library.findIndex((item) => item.id === params.anchorId) : -1;
    const offset = params.anchorId ? (missing || rank < 0 ? 0 : Math.max(0, rank - 12)) : params.offset;
    return { items: library.slice(offset, offset + params.limit), offset, total: library.length };
  });
});
describe("account-scoped Library restoration", () => {
  it("restores a deep anchor at a nonzero scroll position in one bounded request, then pages both ways", async () => {
    localStorage.setItem(key("a"), JSON.stringify({ filters, anchor: { id: id(1900), top: -30 } }));
    mount();
    await waitFor(() => expect(screen.getByText(id(1900))).toBeTruthy());
    expect(window.scrollY).toBe(1110);
    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0][0]).toMatchObject({ anchorId: id(1900), limit: 60 });
    expect(document.querySelectorAll("[data-media-id]")).toHaveLength(60);
    fireEvent.click(screen.getByText("Next"));
    await waitFor(() => expect(screen.getByText(id(2000))).toBeTruthy());
    fireEvent.click(screen.getByText("Earlier"));
    await waitFor(() => expect(screen.getByText(id(1828))).toBeTruthy());
    expect(document.querySelector(`[data-media-id="${id(1900)}"]`)!.getBoundingClientRect().top).toBe(-30);
    const ids = Array.from(document.querySelectorAll<HTMLElement>("[data-media-id]"), (node) => node.dataset.mediaId);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("captures nonzero scrolling and restores after leaving for Watch or reopening with a fresh cache", async () => {
    const first = mount();
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    act(() => { window.scrollTo({ top: 1710 }); fireEvent.scroll(window); });
    fireEvent.click(screen.getByText("Leave"));
    const bookmark = readLibraryBookmark("a");
    expect(bookmark.anchor?.id).toBe(id(22));
    expect(bookmark.anchor?.top).toBe(70);
    first.unmount();
    client = new QueryClient();
    window.scrollTo({ top: 0 });
    mount();
    await waitFor(() => expect(screen.getByText(id(22))).toBeTruthy());
    expect(window.scrollY).toBeGreaterThan(0);
    expect(document.querySelector(`[data-media-id="${id(22)}"]`)!.getBoundingClientRect().top).toBe(70);
  });
  it.each(["deleted", "filtered-out"])("falls back to page zero for a %s anchor without losing filters", async () => {
    missing = true;
    localStorage.setItem(key("a"), JSON.stringify({
      filters: { ...filters, search: "sunset", kind: "video", favorites: true, collectionFilter: "Trips" },
      anchor: { id: id(1900), top: 70 },
    }));
    mount();
    await waitFor(() => expect(screen.getByText(id(0))).toBeTruthy());
    expect(window.scrollY).toBe(0);
    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0][0]).toMatchObject({ q: "sunset", type: "video", favorites: true, collection: "Trips" });
    expect((screen.getByLabelText("Search") as HTMLInputElement).value).toBe("sunset");
  });
  it("persists every filter, clears anchors on changes, and never copies them to another account", async () => {
    const view = mount();
    await waitFor(() => expect(screen.getByText(id(0))).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "hello" } });
    fireEvent.click(screen.getByText("Videos"));
    fireEvent.click(screen.getByText("Saved"));
    fireEvent.click(screen.getByText("Trips"));
    expect(readLibraryBookmark("a").filters).toEqual({ ...filters, search: "hello", kind: "video", favorites: true, collectionFilter: "Trips" });
    fireEvent.click(screen.getByText("Unsorted"));
    expect(readLibraryBookmark("a")).toEqual({
      filters: { ...filters, search: "hello", kind: "video", favorites: true, uncategorized: true }, anchor: null,
    });
    view.rerender(<QueryClientProvider client={client}><Harness key="b" account="b" /></QueryClientProvider>);
    await waitFor(() => expect((screen.getByLabelText("Search") as HTMLInputElement).value).toBe(""));
    expect(readLibraryBookmark("b")).toEqual({ filters, anchor: null });
    view.rerender(<QueryClientProvider client={client}><Harness key="a" account="a" /></QueryClientProvider>);
    expect((screen.getByLabelText("Search") as HTMLInputElement).value).toBe("hello");
    fireEvent.click(screen.getByText("Clear"));
    expect(readLibraryBookmark("a")).toEqual({ filters, anchor: null });
  });
  it("ignores corrupt saved state and keeps browsing when browser storage is blocked", async () => {
    localStorage.setItem(key("a"), "{oops");
    expect(readLibraryBookmark("a")).toEqual({ filters, anchor: null });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    mount();
    await waitFor(() => expect(screen.getByText(id(0))).toBeTruthy());
    fireEvent.click(screen.getByText("Videos"));
    expect(api).toHaveBeenLastCalledWith(expect.objectContaining({ type: "video" }), expect.anything());
  });
});
