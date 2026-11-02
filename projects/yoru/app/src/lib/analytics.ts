/** Aggregate product analytics only; never include content, URLs or identifiers. */
type EventData = {
  upload_batch_started: { file_count: number };
  upload_batch_finished: { completed_count: number; failed_count: number };
  cloud_import_started: { file_count: number };
  post_action_saved: { action: "like" | "dislike" | "clear-reaction" | "save" | "unsave"; surface: "scroll" | "player" };
  creator_follow_changed: { following: boolean };
  comment_created: undefined;
  private_labels_saved: undefined;
};

type AnalyticsData = Record<string, string | number | boolean>;
declare global {
  interface Window {
    umami?: { track(name: string, data?: AnalyticsData): void | Promise<unknown> };
  }
}

const fields: Record<keyof EventData, readonly string[]> = {
  upload_batch_started: ["file_count"],
  upload_batch_finished: ["completed_count", "failed_count"],
  cloud_import_started: ["file_count"],
  post_action_saved: ["action", "surface"],
  creator_follow_changed: ["following"],
  comment_created: [],
  private_labels_saved: [],
};

export function trackEvent<K extends keyof EventData>(name: K, ...args: EventData[K] extends undefined ? [] : [EventData[K]]): void {
  if (typeof window === "undefined" || !Object.prototype.hasOwnProperty.call(fields, name)) return;
  try {
    const input = args[0] as AnalyticsData | undefined;
    const safe: AnalyticsData = {};
    for (const key of fields[name]) {
      const value = input?.[key];
      if (key.endsWith("_count")) {
        if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return;
      } else if (key === "action") {
        if (!["like", "dislike", "clear-reaction", "save", "unsave"].includes(String(value))) return;
      } else if (key === "surface") {
        if (value !== "scroll" && value !== "player") return;
      } else if (typeof value !== "boolean") return;
      safe[key] = value!;
    }
    // Handle synchronous throws AND rejected promises without affecting the app.
    void Promise.resolve(window.umami?.track(name, safe)).catch(() => undefined);
  } catch {
    // An absent or failing analytics tracker must never interrupt an interaction.
  }
}

export function trackPostAction(action: string, surface: "scroll" | "player"): void {
  if (action === "like" || action === "dislike" || action === "clear-reaction" || action === "save" || action === "unsave") {
    trackEvent("post_action_saved", { action, surface });
  }
}
