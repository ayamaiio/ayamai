import { cn } from "@workspace/ayamai-design-system/lib/utils";

/** Faithful raster extraction from recovered pale-blue profile composite. */
export function BrandMark({ className, title }: { className?: string; title?: string }) {
  return <img src="/ui/brand/mark.png" className={cn("h-7 w-7 shrink-0", className)} alt={title ?? ""} width={28} height={28} />;
}
