import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  requestCaptureUpload: vi.fn(), createMedia: vi.fn(), getPostAnnotation: vi.fn(), updatePostAnnotation: vi.fn(),
}));
const put = vi.hoisted(() => vi.fn());
vi.mock("@workspace/api-client-react", () => api);
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn().mockResolvedValue(undefined) }) }));
vi.mock("./direct-upload", () => ({ putFile: put }));
import { useBrowserCapture, useCaptureSave } from "./use-browser-capture";
const nonce = "11111111-1111-4111-8111-111111111111";
const message = (data: object) => window.dispatchEvent(new MessageEvent("message", {
  source: window, origin: location.origin,
  data: { channel: "ayamai-capture", nonce, requestId: "pair-request", ...data },
}));
beforeEach(() => {
  vi.clearAllMocks();
  location.hash = `capture=${nonce}`;
});
describe("explicit, account-isolated transfer", () => {
  it("still accepts an already-installed extension using the old channel name", () => {
    const sent = vi.spyOn(window, "postMessage").mockImplementation(() => {});
    const { result } = renderHook(() => useBrowserCapture("owner"));
    act(() => window.dispatchEvent(new MessageEvent("message", {
      source: window, origin: location.origin,
      data: { channel: "ayanami-capture", nonce, requestId: "legacy-pair", kind: "pair" },
    })));
    act(() => result.current.pair());
    expect(sent).toHaveBeenCalledWith(expect.objectContaining({ channel: "ayanami-capture-response", uid: "owner" }), location.origin);
    sent.mockRestore();
  });
  it("requires pairing, accepts one bounded file, acknowledges retries and rejects old-account bytes", () => {
    const sent = vi.spyOn(window, "postMessage").mockImplementation(() => {});
    const { result, unmount } = renderHook(() => useBrowserCapture("owner"));
    const payload = { kind: "file", requestId: "file-1", uid: "owner", base64: btoa("abc"), size: 3, contentType: "image/png", sourceUrl: "https://example.com/posts/1?token=secret" };
    act(() => message(payload));
    expect(result.current.file).toBeNull();
    act(() => { message({ kind: "pair" }); result.current.pair(); });
    expect(result.current.paired).toBe(true);
    act(() => message(payload));
    const file = result.current.file;
    expect(file?.size).toBe(3); expect(result.current.sourceUrl).toBe("https://example.com/posts/1");
    act(() => message(payload));
    expect(result.current.file).toBe(file);
    expect(sent).toHaveBeenLastCalledWith(expect.objectContaining({ ok: true, requestId: "file-1" }), location.origin);
    act(() => message({ ...payload, requestId: "file-2" }));
    expect(result.current.file).toBe(file);
    unmount();
    const switched = renderHook(() => useBrowserCapture("other-account"));
    act(() => { message({ kind: "pair" }); switched.result.current.pair(); });
    act(() => message(payload));
    expect(switched.result.current.file).toBeNull();
    expect(sent).toHaveBeenLastCalledWith(expect.objectContaining({ error: expect.stringContaining("account changed") }), location.origin);
    sent.mockRestore();
  });
});
describe("frozen capture save", () => {
  const annotation = { expectedRevision: 0, tags: ["private"], notes: "private note", attributes: {}, confidence: "unsure" as const, reviewStatus: "draft" as const, sourceUrl: null };
  const posting = { visibility: "private" as const, attribution: "anonymous" as const, rightsConfirmed: false, description: "", tags: [] };
  function file() {
    return Object.assign(new File(["abc"], "test.png", { type: "image/png" }), { arrayBuffer: async () => new ArrayBuffer(3) });
  }
  beforeEach(() => {
    vi.stubGlobal("crypto", { subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer) } });
    api.requestCaptureUpload.mockResolvedValue({ uploadUrl: "https://storage.example/one", objectKey: "media/owner/capture-key" });
    api.createMedia.mockResolvedValue({ id: "media-id" });
    api.getPostAnnotation.mockResolvedValue({ revision: 0 });
    api.updatePostAnnotation.mockResolvedValue({ revision: 1 });
    put.mockResolvedValue(undefined);
  });
  it("retries a lost create response with the same object and frozen choices, labels separately", async () => {
    api.createMedia.mockRejectedValueOnce(new Error("Connection lost"));
    const { result } = renderHook(() => useCaptureSave("owner"));
    const selected = file();
    await act(async () => { await result.current.save(selected, "", posting, annotation, "First title", "First collection"); });
    expect(result.current.locked).toBe(true); expect(result.current.done).toBe(false);
    await act(async () => { await result.current.save(selected, "", { ...posting, visibility: "public" }, { ...annotation, notes: "changed" }, "Changed", "Changed"); });
    expect(api.requestCaptureUpload).toHaveBeenCalledTimes(1); expect(put).toHaveBeenCalledTimes(1);
    const first = api.createMedia.mock.calls[0], second = api.createMedia.mock.calls[1];
    expect(second[0]).toEqual(first[0]);
    expect(second[1].headers).toEqual({ "X-Capture-Account": "owner" });
    expect(api.updatePostAnnotation.mock.calls[0][1].notes).toBe("private note");
    expect(result.current.done).toBe(true);
  });
  it("keeps established private labels and reports original publication settings on duplicates", async () => {
    api.createMedia.mockResolvedValue({ id: "existing", captureDuplicate: true });
    api.getPostAnnotation.mockResolvedValue({ revision: 4 });
    const { result } = renderHook(() => useCaptureSave("owner"));
    await act(async () => { await result.current.save(file(), "", posting, annotation, "New title", ""); });
    expect(api.updatePostAnnotation).not.toHaveBeenCalled();
    expect(result.current.phase).toMatch(/Original title and publication settings unchanged/);
    expect(result.current.done).toBe(true);
  });
  it("retries a label failure without creating another media item", async () => {
    api.updatePostAnnotation.mockRejectedValueOnce(new Error("Label save failed"));
    const { result } = renderHook(() => useCaptureSave("owner"));
    const selected = file();
    await act(async () => { await result.current.save(selected, "", posting, annotation, "Title", ""); });
    expect(result.current.done).toBe(false);
    await act(async () => { await result.current.save(selected, "", posting, annotation, "Title", ""); });
    expect(api.createMedia).toHaveBeenCalledTimes(1); expect(api.updatePostAnnotation).toHaveBeenCalledTimes(2);
    expect(result.current.done).toBe(true);
  });
  it("aborts and never creates an item after the paired screen unmounts", async () => {
    let finish!: (value: object) => void;
    api.requestCaptureUpload.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { result, unmount } = renderHook(() => useCaptureSave("owner"));
    let pending!: Promise<void>;
    act(() => { pending = result.current.save(file(), "", posting, annotation, "Title", ""); });
    await waitFor(() => expect(api.requestCaptureUpload).toHaveBeenCalledTimes(1));
    const signal = api.requestCaptureUpload.mock.calls[0][1].signal;
    unmount(); expect(signal.aborted).toBe(true);
    finish({ uploadUrl: "https://storage.example/new", objectKey: "key" });
    await pending;
    expect(put).not.toHaveBeenCalled(); expect(api.createMedia).not.toHaveBeenCalled();
  });
});
