import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CreateMediaBody,
  ListMediaQueryParams,
  ListMediaResponse,
  RequestMediaUploadUrlBody,
  UpdateMediaBody,
  UpdateMediaParams,
} from "../src/index.ts";
import { insertMediaItemSchema } from "../../db/src/schema/mediaItems.ts";

test("list validation preserves defaults, query coercion, and limits", () => {
  assert.deepEqual(ListMediaQueryParams.parse({}), {
    type: "all",
    limit: 30,
    offset: 0,
  });
  assert.equal(ListMediaQueryParams.parse({ limit: "20", offset: "2" }).limit, 20);
  assert.equal(ListMediaQueryParams.safeParse({ limit: "61" }).success, false);
  assert.equal(ListMediaQueryParams.safeParse({ offset: "-1" }).success, false);
  assert.equal(ListMediaResponse.safeParse({ items: [], total: 0, offset: 0 }).success, true);
  assert.equal(ListMediaResponse.safeParse({ items: [], total: 0 }).success, false);
});

test("partial updates preserve omitted fields, explicit nulls, and UUID checks", () => {
  assert.deepEqual(UpdateMediaBody.parse({}), {});
  assert.deepEqual(
    UpdateMediaBody.parse({ collection: null, progressSeconds: null }),
    { collection: null, progressSeconds: null },
  );
  assert.deepEqual(UpdateMediaBody.parse({ isFavorite: true }), { isFavorite: true });
  assert.equal(UpdateMediaParams.safeParse({ id: "bad-id" }).success, false);
  assert.equal(
    UpdateMediaParams.safeParse({ id: "550e8400-e29b-41d4-a716-446655440000" }).success,
    true,
  );
});

test("upload and Drizzle schemas accept large media and reject invalid fields", () => {
  const media = {
    title: "Video",
    originalName: "video.mp4",
    contentType: "video/mp4",
    size: 5 * 1024 ** 3,
    mediaType: "video",
    objectKey: "private/test/video.mp4",
  };
  assert.equal(CreateMediaBody.safeParse(media).success, true);
  assert.equal(CreateMediaBody.safeParse({ ...media, size: -1 }).success, false);
  assert.equal(CreateMediaBody.safeParse({ ...media, title: "" }).success, false);
  assert.equal(
    RequestMediaUploadUrlBody.safeParse({
      name: media.originalName,
      size: media.size,
      contentType: media.contentType,
      mediaType: media.mediaType,
    }).success,
    true,
  );
  assert.equal(
    insertMediaItemSchema.safeParse({ ...media, userId: "test-user" }).success,
    true,
  );
});
