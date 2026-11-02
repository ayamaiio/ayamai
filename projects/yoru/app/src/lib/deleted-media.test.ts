import { QueryClient } from "@tanstack/react-query";
import { beforeEach, expect, test } from "vitest";
import { forgetDeletedMedia, withoutDeletedMedia } from "./deleted-media";
import { readVideoProgress, rememberVideoProgress } from "./video-progress";

beforeEach(() => localStorage.clear());
test("deletion removes list entries while preserving pages, cursors, filters and other posts", () => {
  const keep = { id: "keep" }, remove = { id: "remove" };
  const source = { pages: [{ items: [remove, keep], nextCursor: "cursor", hasMore: true }], pageParams: [""] };
  expect(withoutDeletedMedia(source, "remove")).toEqual({
    pages: [{ items: [keep], nextCursor: "cursor", hasMore: true }], pageParams: [""],
  });
  expect(withoutDeletedMedia(source, "absent")).toBe(source);
});
test("one deleted gallery reduces the post count on every loaded page, not its image count", () => {
  const source = { pages: [
    { items: [{ id: "keep" }], total: 2, nextCursor: "next" },
    { items: [{ id: "remove", attachments: [{ id: "a" }, { id: "b" }] }], total: 2, nextCursor: null },
  ], pageParams: ["", "next"] };
  expect(withoutDeletedMedia(source, "remove")).toEqual({ pages: [
    { items: [{ id: "keep" }], total: 1, nextCursor: "next" },
    { items: [], total: 1, nextCursor: null },
  ], pageParams: ["", "next"] });
});
test("Library, Watch, Saved, desktop videos and profile lists all forget deleted uploads", async () => {
  const client = new QueryClient();
  const routes = ["/api/media", "/api/watch/feed", "/api/social/feed", "/api/social/saved", "/api/social/videos", "/api/social/profiles/person"];
  for (const route of routes) client.setQueryData([route, "viewer"], { pages: [{ items: [{ id: "remove" }, { id: "keep" }] }], pageParams: [""] });
  client.setQueryData(["/api/social/posts/remove", "viewer"], { id: "remove" });
  rememberVideoProgress(client, "viewer", "remove", 20, 100);
  rememberVideoProgress(client, "viewer", "keep", 30, 100);
  await forgetDeletedMedia(client, "remove", "viewer");
  for (const route of routes) {
    expect(client.getQueryData([route, "viewer"])).toEqual({ pages: [{ items: [{ id: "keep" }] }], pageParams: [""] });
    expect(client.getQueryState([route, "viewer"])?.isInvalidated).toBe(true);
  }
  expect(client.getQueryData(["/api/social/posts/remove", "viewer"])).toBeUndefined();
  expect(readVideoProgress("viewer").remove).toBeUndefined();
  expect(readVideoProgress("viewer").keep.seconds).toBe(30);
  client.clear();
});
