import { useState } from "react";
import { useUser } from "@clerk/react";
import { useGetMediaPreview } from "@workspace/api-client-react";
import { ImageOff } from "lucide-react";

export function LibraryPreview({ id, visible }: { id: string; visible: boolean }) {
  const { user } = useUser();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const preview = useGetMediaPreview(id, {
    query: {
      queryKey: ["library-preview", user?.id, id],
      enabled: visible,
      staleTime: 120_000,
      gcTime: 300_000,
      // Pending work and temporary decoder/storage failures have a freshness path.
      refetchInterval: (query) => !visible ? false : query.state.data?.status === "pending" ? 3000 : 120_000,
      retry: 1,
    },
  });
  const url = preview.data?.url;
  const unavailable = preview.isError || preview.data?.status === "unavailable" || (!!url && failedUrl === url);
  // Unmount distant images to release decoded surfaces; never fall back to originals.
  if (visible && url && !unavailable) return <img
    src={url} alt="" loading="lazy" decoding="async"
    onError={() => setFailedUrl(url)}
    className="h-full w-full object-cover"
    data-testid={`img-library-${id}`}
  />;
  return <div
    className={`media-placeholder grid h-full w-full place-items-center ${visible && !unavailable ? "animate-pulse" : ""}`}
    aria-label={unavailable ? "Preview unavailable. Open to view original." : undefined}
  >{unavailable && <ImageOff className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}</div>;
}
