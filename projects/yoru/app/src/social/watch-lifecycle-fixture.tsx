import { useEffect, useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  getGetMediaViewUrlQueryKey,
  type MediaViewUrl,
  type PostAnnotation,
  type SocialPost,
} from "@workspace/api-client-react";
import { Button } from "@workspace/ayamai-design-system/components/ui/button";
import { annotationKey } from "./private-label-sheet";
import { SocialTile } from "./social-tile";

const fixtureId = "lifecycle-fixture";
const gestureFixtureIds = [fixtureId, "gesture-second", "gesture-third", "gesture-fourth"];
const fixtureUid = "watch-lifecycle-fixture";
const fixtureVideoUrl = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

const fixturePost: SocialPost = {
  id: fixtureId,
  mediaType: "video",
  description: "Synthetic clip for real-device Watch lifecycle testing.",
  tags: [],
  visibility: "public",
  attribution: "anonymous",
  profile: null,
  likeCount: 0,
  viewCount: 0,
  progressSeconds: null,
  commentCount: 0,
  reaction: null,
  isSaved: false,
  isOwner: false,
  createdAt: new Date().toISOString(),
  durationSeconds: null,
};

const fixtureMedia: MediaViewUrl = {
  url: fixtureVideoUrl,
  contentType: "video/mp4",
};

const fixtureAnnotation: PostAnnotation = {
  mediaId: fixtureId,
  revision: 0,
  schemaVersion: 1,
  tags: [],
  attributes: {},
  notes: "",
  reviewStatus: "draft",
  confidence: "unsure",
  sourceUrl: null,
  updatedAt: null,
};

const fixtureQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function FixtureContent() {
  const [status, setStatus] = useState("Loading the synthetic clip…");
  const gestures = new URLSearchParams(window.location.search).has("gestures");
  const ids = gestures ? gestureFixtureIds : [fixtureId];
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = scrollRef.current;
    if (!gestures || !root) return;
    // Same native snap/visibility boundary as Watch; no synthetic gesture handlers.
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.65) {
          setActiveIndex(Number((entry.target as HTMLElement).dataset.index));
        }
      }
    }, { root, threshold: [0.65] });
    root.querySelectorAll("[data-index]").forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [gestures]);

  useEffect(() => {
    const video = document.querySelector<HTMLVideoElement>(
      '[data-testid="video-social-lifecycle-fixture"]',
    );
    if (!video) return;

    const updateStatus = () => {
      setStatus(video.paused ? "Paused" : "Playing · autoplay enabled");
    };
    const onError = () => setStatus("The synthetic clip failed to load.");
    video.addEventListener("play", updateStatus);
    video.addEventListener("pause", updateStatus);
    video.addEventListener("error", onError);
    if (!video.paused) updateStatus();

    return () => {
      video.removeEventListener("play", updateStatus);
      video.removeEventListener("pause", updateStatus);
      video.removeEventListener("error", onError);
    };
  }, []);

  return (
    <main ref={scrollRef} data-testid="watch-device-feed" className="relative h-[100dvh] snap-y snap-mandatory overflow-y-auto overscroll-y-contain bg-background text-foreground">
      {ids.map((id, index) => <div key={id} data-index={index} className="h-[100dvh] snap-start snap-always">
        <SocialTile
          post={{ ...fixturePost, id }}
          active={activeIndex === index}
          prefetch={false}
          autoplay
          dataSaver={false}
          behaviorEnabled={false}
          onGone={() => undefined}
          uid={fixtureUid}
        />
      </div>)}
      <section
        aria-label="Watch lifecycle test"
        className="fixed left-3 right-3 top-[calc(12px+env(safe-area-inset-top))] z-40 mx-auto w-full max-w-md rounded-lg border border-border bg-card/95 p-4 shadow-lg backdrop-blur-md md:left-8 md:right-auto md:top-8"
      >
        <h1 className="text-sm font-semibold">Development-only Watch test</h1>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Synthetic clip · autoplay enabled · no account or library media is used.
        </p>
        <p
          className="mt-2 text-xs font-medium"
          role="status"
          aria-live="polite"
          data-testid="watch-lifecycle-status"
        >
          {status}
        </p>
        <Button
          type="button"
          size="sm"
          className="mt-3 min-h-11"
          data-testid="button-start-lifecycle-clip"
          onClick={() => {
            const video = document.querySelector<HTMLVideoElement>(
              'video[data-testid^="video-social-"]',
            );
            if (video) void video.play().catch(() => undefined);
          }}
        >
          Start clip
        </Button>
      </section>
    </main>
  );
}

export function WatchLifecycleFixtureRoute() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    for (const id of gestureFixtureIds) {
      fixtureQueryClient.setQueryData(getGetMediaViewUrlQueryKey(id), fixtureMedia);
      fixtureQueryClient.setQueryData(
        annotationKey(id, fixtureUid),
        { ...fixtureAnnotation, mediaId: id },
      );
    }
    setReady(true);
  }, []);

  if (!ready) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-background p-4 text-foreground">
        <p role="status">Preparing the synthetic Watch clip…</p>
      </main>
    );
  }

  return (
    <QueryClientProvider client={fixtureQueryClient}>
      <FixtureContent />
    </QueryClientProvider>
  );
}
