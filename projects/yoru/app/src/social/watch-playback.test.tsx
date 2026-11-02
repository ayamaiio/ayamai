import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedPage } from "./feed-page";
import { HOLD_MS } from "../lib/watch-gestures";

const mocks = vi.hoisted(() => ({
  items: [] as Array<Record<string, unknown>>,
  fetchNextPage: vi.fn(),
  updateMedia: vi.fn(),
  updateWatchSettings: vi.fn(),
  actOnPost: vi.fn(),
  uid: "viewer-1",
  settingsQuery: vi.fn(),
  settings: { behaviorEnabled: false, autoplayEnabled: true as boolean | null, dataSaverEnabled: false, alwaysVisibleControls: false } as { behaviorEnabled: boolean; autoplayEnabled: boolean | null; dataSaverEnabled: boolean; alwaysVisibleControls?: boolean },
}));

vi.mock("@clerk/react", () => ({ useUser: () => ({ user: { id: mocks.uid } }) }));
vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useInfiniteQuery: () => ({
      data: { pages: [{ items: mocks.items, hasMore: false }] },
      hasNextPage: false,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
      isLoading: false,
      isError: false,
      fetchNextPage: mocks.fetchNextPage,
      refetch: vi.fn(),
    }),
  };
});
vi.mock("@workspace/api-client-react", () => ({
  getGetSocialFeedQueryKey: () => ["/api/social/feed"],
  getGetSocialPostQueryKey: (id: string) => ["/api/social/posts", id],
  getGetSavedSocialPostsQueryKey: () => ["/api/social/saved"],
  getGetWatchSettingsQueryKey: () => ["/api/watch/settings"],
  getGetMediaViewUrlQueryKey: (id: string) => ["/api/media", id, "view"],
  useGetWatchSettings: (options: unknown) => {
    mocks.settingsQuery(options);
    return { data: mocks.settings, isLoading: false, isError: false, refetch: vi.fn() };
  },
  useUpdateWatchSettings: () => ({ mutate: mocks.updateWatchSettings, isPending: false }),
  useGetMediaViewUrl: (id: string) => ({ data: { url: `/media/${id}.mp4` }, isLoading: false, isError: false, refetch: vi.fn() }),
  useActOnSocialPost: () => ({ mutate: mocks.actOnPost, isPending: false }),
  useUpdateMedia: () => ({ mutate: mocks.updateMedia }),
  getGetLabelCatalogQueryKey: (params?: unknown) => ["/api/social/labels", ...(params ? [params] : [])],
  getGetPostAnnotationQueryKey: (id: string) => ["/api/social/posts", id, "annotation"],
  useGetLabelCatalog: () => ({ data: { items: [] }, isLoading: false, isError: false }),
  useGetPostAnnotation: () => ({ data: undefined, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() }),
  useUpdatePostAnnotation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("./app-nav", () => ({ AppNav: () => null }));
vi.mock("./use-social-telemetry", () => ({
  useSocialTelemetry: () => ({ onTimeUpdate: vi.fn(), onSeek: vi.fn(), onPause: vi.fn() }),
}));
vi.mock("./comments-sheet", () => ({ CommentsSheet: () => null }));
vi.mock("@/social/social-lib", () => ({
  sessionFor: () => "test-session",
  refreshSocial: vi.fn(),
  timeAgo: () => "now",
}));

type ObservedEntry = Pick<IntersectionObserverEntry, "target" | "isIntersecting">;
class TestIntersectionObserver {
  static instances: TestIntersectionObserver[] = [];
  readonly observed: Element[] = [];
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    TestIntersectionObserver.instances.push(this);
  }
  observe(target: Element) { this.observed.push(target); }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
  trigger(index: number) {
    const target = this.observed.find((node) => (node as HTMLElement).dataset.index === String(index));
    if (!target) throw new Error(`No observed Watch card at index ${index}`);
    this.callback([{ target, isIntersecting: true } as ObservedEntry as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

function post(id: string, mediaType: "video" | "image") {
  return {
    id,
    title: id,
    originalName: `${id}.mp4`,
    mediaType,
    contentType: mediaType === "video" ? "video/mp4" : "image/jpeg",
    size: 100,
    isFavorite: false,
    progressSeconds: null,
    createdAt: new Date(0).toISOString(),
    reaction: null,
    attribution: "anonymous",
    profile: null,
    isOwner: false,
    description: "",
    tags: [],
    likeCount: 0,
    commentCount: 0,
    isSaved: false,
    durationSeconds: 30,
  };
}

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

function renderFeed(saved = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(<QueryClientProvider client={client}><FeedPage saved={saved} /></QueryClientProvider>);
  return { ...result, client };
}

const originalHiddenDescriptor = Object.getOwnPropertyDescriptor(document, "hidden");
let restorePausedDescriptor: (() => void) | undefined;

function trackPlayback() {
  const playing = new WeakSet<HTMLMediaElement>();
  const startPlaying = (video: HTMLMediaElement) => {
    playing.add(video);
    video.dispatchEvent(new Event("play"));
    video.dispatchEvent(new Event("playing"));
  };
  const originalPausedDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "paused");
  Object.defineProperty(HTMLMediaElement.prototype, "paused", {
    configurable: true,
    get(this: HTMLMediaElement) { return !playing.has(this); },
  });
  restorePausedDescriptor = () => {
    if (originalPausedDescriptor) Object.defineProperty(HTMLMediaElement.prototype, "paused", originalPausedDescriptor);
    else Reflect.deleteProperty(HTMLMediaElement.prototype, "paused");
  };
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    startPlaying(this);
    return Promise.resolve();
  });
  const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
    playing.delete(this);
    this.dispatchEvent(new Event("pause"));
  });
  const delayNextPlay = () => {
    let complete: (() => void) | undefined;
    play.mockImplementationOnce(function (this: HTMLMediaElement) {
      return new Promise<void>((resolve) => {
        complete = () => { startPlaying(this); resolve(); };
      });
    });
    return async () => {
      if (!complete) throw new Error("No pending play request");
      await act(async () => complete!());
    };
  };
  return { play, pause, delayNextPlay, isPlaying: (video: HTMLMediaElement) => playing.has(video) };
}

function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
  act(() => document.dispatchEvent(new Event("visibilitychange")));
}

function pointer(target: Element, type: string, values: { x: number; y: number }) {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, {
    pointerId: 7, isPrimary: true, button: 0, clientX: values.x, clientY: values.y,
  });
  fireEvent(target, event);
}

beforeEach(() => {
  TestIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
  mocks.items = [post("one", "video"), post("two", "video")];
  mocks.settings = { behaviorEnabled: false, autoplayEnabled: true, dataSaverEnabled: false };
  mocks.uid = "viewer-1";
  mocks.updateWatchSettings.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  restorePausedDescriptor?.();
  restorePausedDescriptor = undefined;
  if (originalHiddenDescriptor) Object.defineProperty(document, "hidden", originalHiddenDescriptor);
  else Reflect.deleteProperty(document, "hidden");
  vi.unstubAllGlobals();
});

describe("Watch active-video playback", () => {
  it.each([false, true])("saves and restores always-visible controls in Saved=%s", async (saved) => {
    mocks.items = [post("photo", "image")];
    const view = renderFeed(saved);
    fireEvent.click(screen.getByTestId("button-watch-settings"));
    const toggle = screen.getByTestId("switch-watch-always-visible-controls");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(mocks.updateWatchSettings).toHaveBeenCalledWith(
      { data: { alwaysVisibleControls: true } }, expect.any(Object),
    );
    mocks.settings = { ...mocks.settings, alwaysVisibleControls: true };
    act(() => mocks.updateWatchSettings.mock.calls.at(-1)?.[1].onSuccess(mocks.settings));
    expect(view.client.getQueryData(["/api/watch/settings", "viewer-1"])).toEqual(mocks.settings);
    view.unmount();
    renderFeed(saved);
    vi.useFakeTimers();
    act(() => vi.advanceTimersByTime(3000));
    const nav = screen.getByTestId("button-watch-settings").parentElement!;
    expect(nav.getAttribute("aria-hidden")).toBe("false");
    expect(nav.hasAttribute("inert")).toBe(false);
    expect(screen.getByTestId("button-like-photo").closest("[data-watch-chrome]")?.getAttribute("aria-hidden")).toBe("false");
    fireEvent.click(screen.getByTestId("button-watch-settings"));
    expect(screen.getByTestId("switch-watch-always-visible-controls").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByTestId("switch-watch-always-visible-controls"));
    expect(mocks.updateWatchSettings).toHaveBeenLastCalledWith(
      { data: { alwaysVisibleControls: false } }, expect.any(Object),
    );
  });

  it("keeps a previous account's delayed save out of the next account's cache and controls", () => {
    vi.useFakeTimers();
    mocks.items = [post("photo", "image")];
    const view = renderFeed();
    fireEvent.click(screen.getByTestId("button-watch-settings"));
    fireEvent.click(screen.getByTestId("switch-watch-always-visible-controls"));
    const callbacks = mocks.updateWatchSettings.mock.calls.at(-1)![1];
    mocks.uid = "viewer-2";
    view.rerender(<QueryClientProvider client={view.client}><FeedPage /></QueryClientProvider>);
    expect(mocks.settingsQuery).toHaveBeenLastCalledWith(expect.objectContaining({
      query: expect.objectContaining({ queryKey: ["/api/watch/settings", "viewer-2"] }),
    }));
    act(() => callbacks.onSuccess({ ...mocks.settings, alwaysVisibleControls: true }));
    expect(view.client.getQueryData(["/api/watch/settings", "viewer-2"])).toBeUndefined();
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByTestId("button-watch-settings").parentElement?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByText("Watch controls will stay visible.")).toBeNull();
  });
  it("browses Saved fullscreen and removes an unsaved post without clearing its like", async () => {
    mocks.items = [{ ...post("saved-video", "video"), isSaved: true, reaction: "like", likeCount: 7 }];
    mocks.actOnPost.mockImplementation(({ data }, { onSuccess }) => {
      expect(data).toEqual({ action: "unsave" });
      onSuccess({ post: { ...mocks.items[0], isSaved: false } });
    });
    renderFeed(true);
    expect(screen.getByText("Saved · Only you")).toBeTruthy();
    expect(screen.queryByTestId("button-new-feed-cycle")).toBeNull();
    expect(screen.getByTestId("button-like-saved-video").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("button-save-saved-video"));
    expect(mocks.actOnPost).toHaveBeenCalledWith(
      { id: "saved-video", data: { action: "unsave" } }, expect.any(Object),
    );
    await waitFor(() => expect(screen.getByText("No saved posts here yet.")).toBeTruthy());
  });

  it("saves Watch autoplay changes to account settings", async () => {
    setViewport(390, 844);
    renderFeed();
    fireEvent.click(screen.getByTestId("button-watch-settings"));
    const toggle = await screen.findByTestId("switch-watch-autoplay");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(mocks.updateWatchSettings).toHaveBeenCalledWith(
      { data: { autoplayEnabled: false } },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it("saves the Watch-only data saver preference", async () => {
    setViewport(390, 844);
    renderFeed();
    fireEvent.click(screen.getByTestId("button-watch-settings"));
    const toggle = await screen.findByTestId("switch-watch-data-saver");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(mocks.updateWatchSettings).toHaveBeenCalledWith(
      { data: { dataSaverEnabled: true } },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it("keeps manual playback available and avoids autoplay/preload in data saver mode", async () => {
    mocks.settings = { behaviorEnabled: false, autoplayEnabled: true, dataSaverEnabled: true };
    setViewport(390, 844);
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    renderFeed();
    const video = await screen.findByTestId("video-social-one");
    expect(video).toHaveProperty("preload", "none");
    expect(play).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByTestId("watch-gesture-surface"), { key: " " });
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("honors a saved account preference when loading Watch", async () => {
    mocks.settings = { behaviorEnabled: false, autoplayEnabled: false, dataSaverEnabled: false };
    setViewport(390, 844);
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    renderFeed();
    fireEvent.click(screen.getByTestId("button-watch-settings"));
    await screen.findByTestId("video-social-one");
    expect(screen.getByTestId("switch-watch-autoplay").getAttribute("aria-checked")).toBe("false");
    expect(play).not.toHaveBeenCalled();
  });

  it("migrates a saved browser choice when the account has none yet", async () => {
    mocks.settings = { behaviorEnabled: false, autoplayEnabled: null, dataSaverEnabled: false };
    window.localStorage.setItem("afterframe.watch.autoplay.viewer-1", "false");
    setViewport(390, 844);
    renderFeed();
    await waitFor(() => expect(mocks.updateWatchSettings).toHaveBeenCalledWith(
      { data: { autoplayEnabled: false } },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    ));
  });

  it.each([
    ["mobile", 390, 844],
    ["desktop", 1440, 900],
  ])("plays only the active card on a %s viewport", async (_label, width, height) => {
    setViewport(width, height);
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    renderFeed();

    const firstVideo = await screen.findByTestId("video-social-one");
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(firstVideo).toHaveProperty("muted", true);
    expect(firstVideo.closest("article")?.classList.contains("h-[100dvh]")).toBe(true);

    const observer = TestIntersectionObserver.instances[0];
    expect(observer.options?.threshold).toBe(0.6);
    act(() => observer.trigger(1));

    const nextVideo = await screen.findByTestId("video-social-two");
    await waitFor(() => expect(pause).toHaveBeenCalled());
    expect(pause.mock.contexts).toContain(firstVideo);
    expect(screen.queryAllByTestId(/^video-social-/)).toHaveLength(1);
    expect(nextVideo).toHaveProperty("muted", true);
    expect(nextVideo.closest("article")?.classList.contains("h-[100dvh]")).toBe(true);
  });

  it("keeps vertical feed swipes scrollable without seeking or replaying the old clip", async () => {
    setViewport(390, 844);
    const playback = trackPlayback();
    renderFeed();
    const firstVideo = await screen.findByTestId("video-social-one") as HTMLVideoElement;
    await waitFor(() => expect(playback.isPlaying(firstVideo)).toBe(true));
    Object.defineProperties(firstVideo, {
      currentTime: { configurable: true, writable: true, value: 10 },
      duration: { configurable: true, value: 100 },
    });
    const surface = screen.getByTestId("watch-gesture-surface");
    Object.defineProperty(surface, "clientWidth", { configurable: true, value: 400 });
    surface.setPointerCapture = vi.fn();
    surface.hasPointerCapture = vi.fn(() => true);
    surface.releasePointerCapture = vi.fn();
    vi.useFakeTimers();

    act(() => {
      pointer(screen.getByRole("slider"), "pointerdown", { x: 100, y: 300 });
      vi.advanceTimersByTime(HOLD_MS);
    });
    pointer(surface, "pointermove", { x: 106, y: 350 });
    act(() => TestIntersectionObserver.instances[0].trigger(1));

    const nextVideo = screen.getByTestId("video-social-two");
    expect(nextVideo).toBeTruthy();
    expect(firstVideo.currentTime).toBe(10);
    expect(playback.play.mock.contexts.filter((video) => video === firstVideo)).toHaveLength(1);
    expect(playback.isPlaying(firstVideo)).toBe(false);
  });

  it("pauses on a hidden tab and resumes a clip that was playing", async () => {
    const playback = trackPlayback();
    renderFeed();
    const video = await screen.findByTestId("video-social-one") as HTMLVideoElement;
    await waitFor(() => expect(playback.isPlaying(video)).toBe(true));

    setDocumentHidden(true);
    expect(playback.isPlaying(video)).toBe(false);
    expect(playback.pause).toHaveBeenCalled();

    setDocumentHidden(false);
    await waitFor(() => expect(playback.isPlaying(video)).toBe(true));
    expect(playback.play).toHaveBeenCalledTimes(2);
  });

  it("resumes when iOS Safari pauses just before the page becomes hidden", async () => {
    const playback = trackPlayback();
    renderFeed();
    const video = await screen.findByTestId("video-social-one") as HTMLVideoElement;
    await waitFor(() => expect(playback.isPlaying(video)).toBe(true));

    act(() => video.pause());
    expect(playback.isPlaying(video)).toBe(false);
    setDocumentHidden(true);
    setDocumentHidden(false);

    await waitFor(() => expect(playback.isPlaying(video)).toBe(true));
    expect(playback.play).toHaveBeenCalledTimes(2);
  });

  it("keeps a delayed initial play paused after hiding, without making it eligible to resume", async () => {
    const playback = trackPlayback();
    const resolvePlay = playback.delayNextPlay();
    renderFeed();
    const video = await screen.findByTestId("video-social-one") as HTMLVideoElement;
    expect(playback.play).toHaveBeenCalledTimes(1);
    expect(video.paused).toBe(true);

    setDocumentHidden(true);
    await resolvePlay();
    expect(video.paused).toBe(true);
    expect(playback.isPlaying(video)).toBe(false);

    setDocumentHidden(false);
    expect(video.paused).toBe(true);
    expect(playback.play).toHaveBeenCalledTimes(1);
  });

  it.each(["autoplay off", "data saver"] as const)(
    "keeps delayed manual playback paused after a tab switch with %s",
    async (mode) => {
      mocks.settings = {
        behaviorEnabled: false,
        autoplayEnabled: mode !== "autoplay off",
        dataSaverEnabled: mode === "data saver",
      };
      const playback = trackPlayback();
      renderFeed();
      const video = await screen.findByTestId("video-social-one") as HTMLVideoElement;
      expect(playback.play).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId("button-toggle-sound-one"));
      expect(video.muted).toBe(false);

      const resolvePlay = playback.delayNextPlay();
      fireEvent.keyDown(screen.getByTestId("watch-gesture-surface"), { key: " " });
      expect(playback.play).toHaveBeenCalledTimes(1);
      setDocumentHidden(true);
      await resolvePlay();
      expect(video.paused).toBe(true);
      expect(playback.isPlaying(video)).toBe(false);

      setDocumentHidden(false);
      expect(video.paused).toBe(true);
      expect(playback.play).toHaveBeenCalledTimes(1);
    },
  );

  it.each([false, true])("cancels a delayed resume when switched away again (return before resolution: %s)", async (returnBeforeResolution) => {
    const playback = trackPlayback();
    renderFeed();
    const video = await screen.findByTestId("video-social-one") as HTMLVideoElement;
    await waitFor(() => expect(playback.isPlaying(video)).toBe(true));
    // Exercise the audio risk, not just a muted autoplay clip.
    fireEvent.click(screen.getByTestId("button-toggle-sound-one"));
    expect(video.muted).toBe(false);

    setDocumentHidden(true);
    const resolvePlay = playback.delayNextPlay();
    setDocumentHidden(false);
    expect(playback.play).toHaveBeenCalledTimes(2);
    expect(video.paused).toBe(true);

    setDocumentHidden(true);
    if (returnBeforeResolution) setDocumentHidden(false);
    await resolvePlay();
    expect(video.paused).toBe(true);
    expect(playback.isPlaying(video)).toBe(false);

    if (!returnBeforeResolution) setDocumentHidden(false);
    expect(video.paused).toBe(true);
    expect(playback.play).toHaveBeenCalledTimes(2);

    setDocumentHidden(true);
    setDocumentHidden(false);
    expect(video.paused).toBe(true);
    expect(playback.play).toHaveBeenCalledTimes(2);
  });

  it.each(["autoplay off", "data saver", "inactive clip"] as const)(
    "does not revive delayed playback after returning with %s",
    async (restriction) => {
      const playback = trackPlayback();
      renderFeed();
      const video = await screen.findByTestId("video-social-one") as HTMLVideoElement;
      expect(playback.isPlaying(video)).toBe(true);

      setDocumentHidden(true);
      const resolvePlay = playback.delayNextPlay();
      setDocumentHidden(false);
      setDocumentHidden(true);
      if (restriction === "inactive clip") {
        act(() => TestIntersectionObserver.instances[0].trigger(1));
      } else {
        fireEvent.click(screen.getByTestId("button-watch-settings"));
        fireEvent.click(screen.getByTestId(
          restriction === "autoplay off" ? "switch-watch-autoplay" : "switch-watch-data-saver",
        ));
      }

      await resolvePlay();
      expect(video.paused).toBe(true);
      setDocumentHidden(false);
      expect(video.paused).toBe(true);
      expect(playback.play).toHaveBeenCalledTimes(2);
    },
  );

  it("does not resume after autoplay is disabled while the tab is hidden", async () => {
    const playback = trackPlayback();
    const { client, rerender } = renderFeed();
    const video = await screen.findByTestId("video-social-one") as HTMLVideoElement;
    await waitFor(() => expect(playback.isPlaying(video)).toBe(true));

    setDocumentHidden(true);
    mocks.settings = { ...mocks.settings, autoplayEnabled: false };
    rerender(<QueryClientProvider client={client}><FeedPage saved={false} /></QueryClientProvider>);
    setDocumentHidden(false);

    expect(playback.isPlaying(video)).toBe(false);
    expect(playback.play).toHaveBeenCalledTimes(1);
  });

  it("keeps a manually paused clip paused after hiding and showing the tab", async () => {
    const playback = trackPlayback();
    renderFeed();
    const video = await screen.findByTestId("video-social-one") as HTMLVideoElement;
    await waitFor(() => expect(playback.isPlaying(video)).toBe(true));

    fireEvent.keyDown(screen.getByTestId("watch-gesture-surface"), { key: " " });
    expect(playback.isPlaying(video)).toBe(false);
    setDocumentHidden(true);
    setDocumentHidden(false);

    expect(playback.isPlaying(video)).toBe(false);
    expect(playback.play).toHaveBeenCalledTimes(1);
  });

  it("does not resume a clip that stopped being active while the tab was hidden", async () => {
    const playback = trackPlayback();
    renderFeed();
    await screen.findByTestId("video-social-one");
    setDocumentHidden(true);

    act(() => TestIntersectionObserver.instances[0].trigger(1));
    await screen.findByTestId("video-social-two");
    setDocumentHidden(false);

    expect(playback.play).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByTestId(/^video-social-/)).toHaveLength(1);
  });

  it("does not resume a hidden clip after autoplay is turned off", async () => {
    const playback = trackPlayback();
    renderFeed();
    const video = await screen.findByTestId("video-social-one") as HTMLVideoElement;
    await waitFor(() => expect(playback.isPlaying(video)).toBe(true));
    setDocumentHidden(true);

    fireEvent.click(screen.getByTestId("button-watch-settings"));
    fireEvent.click(screen.getByTestId("switch-watch-autoplay"));
    mocks.settings = { ...mocks.settings, autoplayEnabled: false };
    const onSuccess = mocks.updateWatchSettings.mock.calls.at(-1)?.[1]?.onSuccess;
    act(() => onSuccess?.(mocks.settings));

    setDocumentHidden(false);

    expect(playback.isPlaying(video)).toBe(false);
    expect(playback.play).toHaveBeenCalledTimes(1);
  });

  it("keeps images out of video controls and playback", async () => {
    mocks.items = [post("photo", "image")];
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    renderFeed();

    expect(await screen.findByTestId("img-social-photo")).not.toBeNull();
    expect(screen.queryByTestId("video-social-photo")).toBeNull();
    expect(screen.queryByTestId("button-toggle-sound-photo")).toBeNull();
    expect(play).not.toHaveBeenCalled();
  });

  it("toggles sound on an active video and tolerates rejected autoplay", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new Error("Autoplay blocked"));
    renderFeed();

    const video = await screen.findByTestId("video-social-one");
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(video).toHaveProperty("muted", true);

    const soundButton = screen.getByTestId("button-toggle-sound-one");
    fireEvent.click(soundButton);
    expect(video).toHaveProperty("muted", false);
    expect(soundButton.getAttribute("aria-pressed")).toBe("true");
  });
});

