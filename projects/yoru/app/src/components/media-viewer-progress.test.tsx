import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "@workspace/api-client-react";
import { MediaViewerDialog } from "./media-viewer-dialog";

const updateMedia = vi.hoisted(() => vi.fn());
const regeneratePreview = vi.hoisted(() => vi.fn());

vi.mock("@workspace/api-client-react", () => ({
  useGetMediaViewUrl: () => ({ data: { url: "/media/saved-video.mp4" }, isLoading: false, isError: false, refetch: vi.fn() }),
  getGetMediaViewUrlQueryKey: (id: string) => ["/api/media", id, "view"],
  useGetSocialPost: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }),
  getGetSocialPostQueryKey: (id: string) => ["/api/social/posts", id],
  useActOnSocialPost: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateMedia: () => ({ mutate: updateMedia }),
  useRegenerateMediaPreview: () => ({ mutate: regeneratePreview, isPending: false }),
  getGetGalleryAttachmentViewUrlQueryKey: (id: string, a: string) => ["/api/media", id, "attachments", a],
  useGetGalleryAttachmentViewUrl: () => ({ data: undefined, isError: false, refetch: () => undefined }),
}));
vi.mock("@/components/watch-gesture-layer", () => ({ WatchGestureLayer: () => null }));
vi.mock("@/social/social-lib", () => ({ refreshSocial: vi.fn() }));
vi.mock("@/social/post-editor-dialog", () => ({ PostEditorDialog: () => null }));

const asset = {
  id: "saved-video",
  title: "Saved clip",
  originalName: "saved-video.mp4",
  mediaType: "video",
  contentType: "video/mp4",
  size: 100,
  isFavorite: false,
  progressSeconds: 18,
  createdAt: new Date(0).toISOString(),
  collection: null,
} as MediaAsset;

beforeEach(() => updateMedia.mockClear());

function renderViewer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>
    <MediaViewerDialog
      asset={asset}
      onClose={vi.fn()}
      onToggleFavorite={vi.fn()}
      favoritePending={false}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      deletePending={false}
    />
  </QueryClientProvider>);
}

describe("media viewer playback progress", () => {
  it("rebuilds a library preview without replacing the full-quality viewer source", () => {
    renderViewer();
    fireEvent.click(screen.getByRole("button", { name: "Rebuild library preview" }));
    expect(regeneratePreview.mock.calls[0]?.[0]).toEqual({ id: "saved-video" });
    act(() => regeneratePreview.mock.calls[0]![1].onSuccess());
    expect(screen.getByText("Library preview queued for rebuilding. The original is unchanged.")).toBeTruthy();
    expect(screen.getByTestId("video-viewer-saved-video").getAttribute("src")).toBe("/media/saved-video.mp4");
  });
  it("restores saved progress and persists meaningful playback changes", async () => {
    renderViewer();
    const video = screen.getByTestId("video-viewer-saved-video") as HTMLVideoElement;
    Object.defineProperty(video, "currentTime", { configurable: true, writable: true, value: 0 });
    Object.defineProperty(video, "duration", { configurable: true, value: 60 });
    act(() => fireEvent.loadedMetadata(video));
    expect(video.currentTime).toBe(18);

    act(() => {
      video.currentTime = 24;
      video.dispatchEvent(new Event("timeupdate"));
    });
    expect(updateMedia.mock.calls[0]?.[0]).toEqual({
      id: "saved-video",
      data: { progressSeconds: 24 },
    });
    expect(typeof updateMedia.mock.calls[0]?.[1]?.onSuccess).toBe("function");

    fireEvent.click(screen.getByRole("button", { name: "Close viewer" }));
    expect(updateMedia).toHaveBeenCalledTimes(1);
  });
});
