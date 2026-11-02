import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { SocialPost, VideoReview, VideoReviewsPage } from "@workspace/api-client-react";
import { VideoReviews, reviewsKey } from "./video-reviews";

const api = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), remove: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  getGetVideoReviewsQueryKey: (id: string) => [`/api/social/posts/${id}/reviews`],
  getVideoReviews: api.get, setVideoReview: api.set, deleteVideoReview: api.remove,
}));
const post = {
  id: "00000000-0000-4000-8000-000000000001", mediaType: "video", visibility: "public",
  attribution: "profile", tags: [], description: "", profile: null, likeCount: 0,
  commentCount: 0, reaction: null, isSaved: false, isOwner: false,
  durationSeconds: 900, createdAt: "2026-10-29T00:00:00Z",
  viewCount: 0,
} as SocialPost;
const own: VideoReview = { id: "00000000-0000-4000-8000-000000000002",
  rating: 3, text: "Saved baseline", revision: 1, isOwn: true, updatedAt: "2026-10-29T00:00:00Z" };
const page = (review: VideoReview | null = own): VideoReviewsPage => ({
  ownReview: review, items: review ? [review] : [], canReadOthers: true,
  count: review ? 1 : 0, averageRating: review?.rating ?? null, nextOffset: 1, hasMore: false,
});
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><VideoReviews post={post} uid="viewer" onDirtyChange={() => {}} /></QueryClientProvider>);
  return client;
}
beforeEach(() => { vi.resetAllMocks(); api.get.mockResolvedValue(page()); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("background refresh cannot silently advance the draft's expected saved revision", async () => {
  api.set.mockRejectedValue({ status: 409 });
  const client = mount();
  const text = await screen.findByTestId("input-review-text");
  await waitFor(() => expect((text as HTMLTextAreaElement).value).toBe(own.text));
  fireEvent.change(text, { target: { value: "My unsaved draft" } });
  act(() => { client.setQueryData(reviewsKey(post.id, "viewer"), {
    pages: [page({ ...own, revision: 2, text: "Changed on another device" })], pageParams: [0],
  }); });
  fireEvent.click(screen.getByTestId("button-save-review"));
  await waitFor(() => expect(api.set).toHaveBeenCalledWith(post.id, {
    rating: 3, text: "My unsaved draft", expectedRevision: 1, expectedReviewId: own.id,
  }));
  expect(await screen.findByTestId("button-reload-latest-review")).toBeTruthy();
  expect((text as HTMLTextAreaElement).value).toBe("My unsaved draft");
  client.clear();
});
test("failed explicit reload keeps the review draft instead of hydrating stale or empty data", async () => {
  const client = mount();
  const text = await screen.findByTestId("input-review-text");
  await waitFor(() => expect((text as HTMLTextAreaElement).value).toBe(own.text));
  fireEvent.change(text, { target: { value: "Keep this draft" } });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  api.get.mockRejectedValue(new Error("Offline"));
  fireEvent.click(screen.getByTestId("button-reload-reviews"));
  expect(await screen.findByText("Couldn’t reload the saved review. Your draft is kept.")).toBeTruthy();
  expect((screen.getByTestId("input-review-text") as HTMLTextAreaElement).value).toBe("Keep this draft");
  client.clear();
});
test("save persists the current rating and refreshes visible aggregates", async () => {
  const client = mount();
  const text = await screen.findByTestId("input-review-text");
  await waitFor(() => expect((text as HTMLTextAreaElement).value).toBe(own.text));
  const saved = { ...own, rating: 5, revision: 2, text: "Updated review" };
  api.set.mockResolvedValue(saved);
  api.get.mockResolvedValue(page(saved));
  fireEvent.click(screen.getByTestId("radio-rating-5"));
  fireEvent.change(text, { target: { value: saved.text } });
  fireEvent.click(screen.getByTestId("button-save-review"));
  expect(await screen.findByText("Review saved.")).toBeTruthy();
  await waitFor(() => expect(screen.getByTestId("text-review-average").textContent).toContain("5.0"));
  client.clear();
});
