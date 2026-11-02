import type { QueryClient } from "@tanstack/react-query";
import {
  getGetMediaViewUrlQueryKey,
  getGetSocialAccountQueryKey,
  getGetSocialCommentsQueryKey,
  getGetSocialPostQueryKey,
} from "@workspace/api-client-react";
import type { PostInput, SocialAccount } from "@workspace/api-client-react";

export function errorStatus(err: unknown): number | undefined {
  if (err && typeof err === "object" && typeof (err as { status?: unknown }).status === "number") return (err as { status: number }).status;
  return undefined;
}
export const isGone = (err: unknown) => errorStatus(err) === 404;

export function errorText(err: unknown, fallback: string) {
  if (err && typeof err === "object") {
    const data = (err as { data?: unknown }).data;
    if (data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string") return (data as { error: string }).error;
  }
  return fallback;
}

/** Drop every cached trace of a post so revoked media never re-renders from cache. */
export function forgetPost(client: QueryClient, id: string) {
  client.removeQueries({ queryKey: getGetMediaViewUrlQueryKey(id) });
  client.removeQueries({ queryKey: getGetSocialPostQueryKey(id) });
  client.removeQueries({ queryKey: getGetSocialCommentsQueryKey(id) });
}

export async function refreshSocial(client: QueryClient, id?: string) {
  await Promise.all([
    client.invalidateQueries({ queryKey: ["/api/social/feed"] }),
    client.invalidateQueries({ queryKey: ["/api/social/saved"] }),
    client.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/social/profiles") }),
    id ? client.invalidateQueries({ queryKey: getGetSocialPostQueryKey(id) }) : Promise.resolve(),
  ]);
}
export const refreshAccount = (client: QueryClient) => client.invalidateQueries({ queryKey: getGetSocialAccountQueryKey() });

export type PostingDraft = {
  visibility: "public" | "private";
  attribution: "anonymous" | "profile";
  description: string;
  tagText: string;
  rightsConfirmed: boolean;
};

export const defaultDraft = (): PostingDraft => ({ visibility: "public", attribution: "anonymous", description: "", tagText: "", rightsConfirmed: false });

export function parseTags(text: string) {
  const seen = new Set<string>();
  for (const raw of text.split(/[,#\n]/)) {
    const tag = raw.trim().toLowerCase().slice(0, 40);
    if (tag) seen.add(tag);
  }
  return Array.from(seen).slice(0, 15);
}

export function toPostInput(draft: PostingDraft): PostInput {
  return {
    visibility: draft.visibility,
    attribution: draft.attribution,
    description: draft.description.trim().slice(0, 2000),
    tags: parseTags(draft.tagText),
    rightsConfirmed: draft.visibility === "public" ? draft.rightsConfirmed : false,
  };
}

/** Returns why a draft cannot be posted yet, or null. Private posting never needs the gate. */
export function postingBlocker(draft: PostingDraft, account: SocialAccount | undefined) {
  if (draft.visibility === "private") return null;
  if (!account) return "Loading your sharing settings…";
  if (!account.adultAccepted) return "Confirm you are 18+ and accept the sharing policy before posting publicly.";
  if (draft.attribution === "profile" && !account.profile) return "Create a profile first, or post anonymously.";
  if (!draft.rightsConfirmed) return "Confirm you have the rights and consent to share this.";
  return null;
}

/** Context gets its own cycle. v2 replaces old sampled cycles after eligibility rollout. */
export function sessionFor(userId: string, lane: string, type: string, fresh = false, context?: string) {
  const key = `afterframe.social.session.v2.${userId}.${lane}.${type}${context ? `.${context}` : ""}`;
  const saved = fresh ? null : sessionStorage.getItem(key);
  if (saved) return saved;
  const created = crypto.randomUUID();
  sessionStorage.setItem(key, created);
  return created;
}

export function timeAgo(iso: string) {
  const s = Math.max(1, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
