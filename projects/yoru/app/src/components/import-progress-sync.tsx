import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListImportJobs } from "@workspace/api-client-react";

/** Keep imported media visible even after the upload dialog is closed. */
export function ImportProgressSync() {
  const client = useQueryClient();
  const previous = useRef(new Map<string, number>());
  const { data } = useListImportJobs({
    query: {
      refetchInterval: (query) => query.state.data?.jobs.some((job) =>
        ["queued", "processing", "cancelling"].includes(job.status)) ? 2000 : 30_000,
    },
  });
  useEffect(() => {
    if (!data) return;
    const next = new Map(data.jobs.map((job) => [job.id, job.files.filter((file) => file.status === "complete").length]));
    const changed = [...next].some(([id, count]) => count > (previous.current.get(id) ?? 0));
    previous.current = next;
    if (changed) {
      for (const key of ["/api/media", "/api/media/summary", "/api/media/collections", "/api/watch/feed"]) {
        void client.invalidateQueries({ queryKey: [key] });
      }
    }
  }, [data, client]);
  return null;
}
