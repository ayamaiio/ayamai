import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  requestCaptureUpload, createMedia, getPostAnnotation, updatePostAnnotation,
  type PostInput, type PostAnnotationInput, type CaptureUploadInput,
} from "@workspace/api-client-react";
import { CAPTURE_MAX, CAPTURE_MIMES, decodeCapture } from "./capture-protocol";
import { putFile } from "./direct-upload";
import { errorText } from "@/social/social-lib";

type Message = { channel: string; kind: string; nonce: string; requestId: string; uid?: string; base64?: unknown; contentType?: unknown; size?: unknown; sourceUrl?: unknown };
const CAPTURE_CHANNEL = "ayamai-capture";
const LEGACY_CAPTURE_CHANNEL = "ayanami-capture";
export function useBrowserCapture(uid: string) {
  const [paired, setPaired] = useState(false);
  const [incoming, setIncoming] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [error, setError] = useState("");
  const initialNonce = useRef(new URLSearchParams(location.hash.slice(1)).get("capture"));
  const pending = useRef<Message | null>(null);
  const pairedRef = useRef(false);
  const accepted = useRef<string | null>(null);
  const respond = (data: Message, result: object) => window.postMessage({
    channel: data.channel === LEGACY_CAPTURE_CHANNEL ? "ayanami-capture-response" : "ayamai-capture-response", nonce: data.nonce, requestId: data.requestId, ...result,
  }, location.origin);
  useEffect(() => {
    const nonce = initialNonce.current;
    const validNonce = nonce && /^[a-f0-9-]{36}$/.test(nonce);
    function receive(event: MessageEvent) {
      const data = event.data as Message;
      if (event.source !== window || event.origin !== location.origin || !validNonce ||
          ![CAPTURE_CHANNEL, LEGACY_CAPTURE_CHANNEL].includes(data?.channel) || data.nonce !== nonce ||
          typeof data.requestId !== "string" || data.requestId.length > 80) return;
      if (data.kind === "pair") {
        if (pairedRef.current) respond(data, { uid });
        else pending.current = data;
        return;
      }
      if (data.kind !== "file") return;
      if (!pairedRef.current || data.uid !== uid) { respond(data, { error: "The paired account changed. Start again from the extension." }); return; }
      if (accepted.current === data.requestId) { respond(data, { ok: true }); return; }
      if (accepted.current) { respond(data, { error: "This tab already received a capture. Open a fresh capture." }); return; }
      setIncoming(true);
      try {
        const received = decodeCapture(data as Parameters<typeof decodeCapture>[0]);
        accepted.current = data.requestId;
        setFile(received.file); setSourceUrl(received.sourceUrl); setError("");
        respond(data, { ok: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Invalid capture.");
        respond(data, { error: "Invalid capture. Choose a supported file up to 20 MiB." });
      } finally { setIncoming(false); }
    }
    window.addEventListener("message", receive);
    return () => { window.removeEventListener("message", receive); pairedRef.current = false; pending.current = null; };
  }, [uid]);
  function pair() {
    if (!pending.current) { setError("Start a transfer with the extension, then pair this account in the tab it opens."); return; }
    pairedRef.current = true; setPaired(true); setError("");
    respond(pending.current, { uid });
  }
  // Reset navigates rather than allowing an old extension nonce to accept new data.
  const reset = () => { location.assign(`${import.meta.env.BASE_URL}capture`); };
  return { paired, incoming, file, sourceUrl, error, pair, reset };
}

type Frozen = { file: File; sourceUrl: string; posting: PostInput; annotation: PostAnnotationInput; title: string; collection: string; objectKey?: string; uploaded?: boolean; mediaId?: string; duplicate?: boolean };
export function useCaptureSave(uid: string) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const snap = useRef<Frozen | null>(null);
  const running = useRef(false);
  const alive = useRef(true);
  const abort = useRef(new AbortController());
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; abort.current.abort(); snap.current = null; };
  }, [uid]);
  async function save(file: File, sourceUrl: string, posting: PostInput, annotation: PostAnnotationInput, title: string, collection: string) {
    if (running.current || done || !alive.current) return;
    if (!snap.current) {
      if (file.size < 1 || file.size > CAPTURE_MAX || !CAPTURE_MIMES.has(file.type)) { setError("Select a supported capture up to 20 MiB."); return; }
      snap.current = { file, sourceUrl, posting: structuredClone(posting), annotation: structuredClone(annotation), title, collection };
    }
    const frozen = snap.current;
    const options = { headers: { "X-Capture-Account": uid }, signal: abort.current.signal };
    const check = () => { if (!alive.current || abort.current.signal.aborted) throw Error("Account changed. Start a new capture."); };
    running.current = true; setBusy(true); setLocked(true); setError("");
    try {
      check();
      if (!frozen.uploaded) {
        setPhase("Checking selected bytes");
        const digest = await crypto.subtle.digest("SHA-256", await frozen.file.arrayBuffer());
        check();
        const sha256 = Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
        // Keep the same key on a failed PUT; request a fresh expiring grant only
        // before upload succeeded. A lost media response retries the same key.
        const target = await requestCaptureUpload({ sha256, size: frozen.file.size, contentType: frozen.file.type as CaptureUploadInput["contentType"] }, options);
        check(); frozen.objectKey = target.objectKey;
        setPhase("Uploading selected file");
        await putFile(target.uploadUrl, frozen.file, frozen.file.type, setProgress, abort.current.signal);
        check(); frozen.uploaded = true;
      }
      if (!frozen.mediaId) {
        setPhase("Verifying and saving");
        const item = await createMedia({
          title: frozen.title, collection: frozen.collection.trim() || undefined,
          originalName: frozen.file.name, size: frozen.file.size, contentType: frozen.file.type,
          mediaType: frozen.file.type.startsWith("image/") ? "image" : "video",
          objectKey: frozen.objectKey!, posting: frozen.posting,
        }, options);
        check(); frozen.mediaId = item.id; frozen.duplicate = item.captureDuplicate;
      }
      setPhase("Saving private labels");
      const existing = await getPostAnnotation(frozen.mediaId, options);
      check();
      // Capturing the same bytes must never overwrite an established private label.
      // A revision conflict also preserves the user's previous work.
      if (existing.revision === 0) {
        await updatePostAnnotation(frozen.mediaId, { ...frozen.annotation, expectedRevision: 0 }, options);
        check();
      }
      setProgress(100);
      setPhase(frozen.duplicate ? "Already in your collection. Original title and publication settings unchanged; existing private labels kept when present." : existing.revision > 0 ? "Saved; existing private labels kept." : "Saved to your collection with private labels.");
      await Promise.all([
        client.invalidateQueries({ queryKey: ["/api/media"] }),
        client.invalidateQueries({ queryKey: ["/api/media/summary"] }),
        client.invalidateQueries({ queryKey: ["/api/media/collections"] }),
        client.invalidateQueries({ queryKey: ["/api/social/feed"], refetchType: "none" }),
        client.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).includes("/annotation") || String(q.queryKey[0]).includes("/label") || String(q.queryKey[0]).startsWith("/api/social/profiles") }),
      ]);
      check(); setDone(true);
    } catch (err) {
      if (alive.current) setError(errorText(err, err instanceof Error ? err.message : "Save failed. Retry sends the same confirmed capture."));
    } finally { running.current = false; if (alive.current) setBusy(false); }
  }
  return { save, busy, locked, progress, phase, error, done };
}
