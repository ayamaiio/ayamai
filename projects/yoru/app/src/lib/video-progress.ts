import { useEffect } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

type Position = { seconds: number; duration: number };
type Positions = Record<string, Position>;
const key = (uid: string) => ["video-playback-progress", uid];
const storageKey = (uid: string) => `ayanami:video-progress:${uid}`;

export function readVideoProgress(uid: string): Positions {
  if (uid === "anon") return {};
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(storageKey(uid)) ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([, p]) =>
      p && typeof p === "object" && Number.isFinite(p.seconds) && p.seconds >= 0
      && Number.isFinite(p.duration) && p.duration > 0));
  } catch { return {}; }
}

export function rememberVideoProgress(client: QueryClient, uid: string, id: string, seconds: number, duration: number) {
  if (uid === "anon" || !Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(duration) || duration <= 0) return;
  client.setQueryData<Positions>(key(uid), previous => {
    const next = { ...(previous ?? readVideoProgress(uid)), [id]: { seconds: Math.min(seconds, duration), duration } };
    try { window.localStorage.setItem(storageKey(uid), JSON.stringify(next)); } catch { /* Storage unavailable: retain the in-memory indicator. */ }
    return next;
  });
}

export function useVideoProgress(uid: string) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: key(uid), queryFn: () => readVideoProgress(uid), initialData: () => readVideoProgress(uid), staleTime: Infinity });
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey(uid) || event.key === null) client.setQueryData(key(uid), readVideoProgress(uid));
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [uid, client]);
  return query.data;
}

export function forgetVideoProgress(client: QueryClient, uid: string, id: string) {
  client.setQueryData<Positions>(key(uid), previous => {
    const next = { ...(previous ?? readVideoProgress(uid)) };
    delete next[id];
    try { window.localStorage.setItem(storageKey(uid), JSON.stringify(next)); } catch { /* Keep the in-memory state correct. */ }
    return next;
  });
}
