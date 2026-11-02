// Story-only compositions of existing primitives. No alternative component implementations.
import { useState, type CSSProperties } from "react";
import {
  Search,
  Grid2X2,
  List,
  Bookmark,
  Library,
  Folder,
  Clock,
  Plus,
  ArrowUpRight,
  Play,
} from "lucide-react";
import { Button } from "@workspace/ayamai-design-system/components/ui/button";
import { Input } from "@workspace/ayamai-design-system/components/ui/input";
import { Badge } from "@workspace/ayamai-design-system/components/ui/badge";
import {
  Card,
  CardContent,
} from "@workspace/ayamai-design-system/components/ui/card";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@workspace/ayamai-design-system/components/ui/tabs";
import { BrandMark } from "../../../projects/yoru/app/src/components/brand-mark";

export type TypeOptions = {
  proposed?: boolean;
  headingSize?: number;
  weight?: number;
  tracking?: number;
};
export function typeStyle({
  proposed = false,
  headingSize = 48,
  weight = 400,
  tracking = -0.02,
}: TypeOptions): CSSProperties {
  return {
    "--lab-heading-font": proposed
      ? '"Bodoni Moda", serif'
      : "var(--app-font-sans)",
    "--lab-body-font": proposed
      ? '"Space Grotesk", sans-serif'
      : "var(--app-font-sans)",
    "--lab-heading-size": `${headingSize}px`,
    "--lab-heading-weight": weight,
    "--lab-heading-tracking": `${tracking}em`,
  } as CSSProperties;
}
const media = [
  {
    title: "The shape of quiet",
    collection: "Blue hour studies",
    duration: "04:32",
    dimensions: "1920 × 1080",
    kind: "Video",
    date: "Oct 28, 2026",
    ratio: "16 / 9",
  },
  {
    title: "After the last train",
    collection: "Small hours",
    duration: "01:48",
    dimensions: "1080 × 1350",
    kind: "Video",
    date: "Oct 26, 2026",
    ratio: "4 / 5",
  },
  {
    title: "A light left on",
    collection: "Collected fragments",
    duration: "Still image",
    dimensions: "1600 × 1200",
    kind: "Image",
    date: "Oct 24, 2026",
    ratio: "4 / 3",
  },
];
export function LibraryStudy(options: TypeOptions & { compact?: boolean }) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("all");
  const [view, setView] = useState("grid");
  const [saved, setSaved] = useState<string[]>([]);
  const [destination, setDestination] = useState("Library");
  const visible = media.filter(
    (m) =>
      m.title.toLowerCase().includes(query.toLowerCase()) &&
      (tab !== "saved" || saved.includes(m.title)),
  );
  return (
    <section
      className={`lab-shell ${options.compact ? "lab-compact" : ""}`}
      style={typeStyle(options)}
    >
      <aside className="lab-sidebar">
        <div className="lab-brand">
          <BrandMark title="Ayamai" />
          <img src="/brand/wordmark.png" alt="Ayamai wordmark" />
        </div>
        <p className="magi-label">Your space</p>
        <nav aria-label="Specimen navigation">
          {[
            [Library, "Library"],
            [Folder, "Collections"],
            [Clock, "Recently added"],
          ].map(([Icon, label]) => {
            const Glyph = Icon as typeof Library;
            const text = label as string;
            return (
              <Button
                key={text}
                variant={destination === text ? "secondary" : "ghost"}
                aria-current={destination === text ? "page" : undefined}
                onClick={() => setDestination(text)}
              >
                <Glyph aria-hidden="true" />
                {text}
              </Button>
            );
          })}
        </nav>
        <p className="lab-sidebar-note">
          Private by nature.
          <br />
          Collected with intention.
        </p>
      </aside>
      <div className="lab-content">
        <div className="lab-topline">
          <span className="magi-label">Personal archive / synthetic study</span>
          <Badge variant="outline">Local specimen</Badge>
        </div>
        <header className="lab-header">
          <div>
            <h1 className="lab-editorial">
              {destination === "Library"
                ? "A quiet place to return to."
                : destination}
            </h1>
            <p className="lab-description">
              Small discoveries, kept close. A library shaped by what stays with
              you.
            </p>
          </div>
        </header>
        <div className="lab-tools">
          <label className="lab-search">
            <Search size={18} aria-hidden="true" />
            <Input
              aria-label="Search specimen library"
              placeholder="Search your library"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="magi-row">
            <Button variant="ghost" onClick={() => setQuery("")}>
              Clear search
            </Button>
            <Button
              variant={view === "grid" ? "secondary" : "ghost"}
              size="icon"
              aria-label="Grid view"
              aria-pressed={view === "grid"}
              onClick={() => setView("grid")}
            >
              <Grid2X2 />
            </Button>
            <Button
              variant={view === "list" ? "secondary" : "ghost"}
              size="icon"
              aria-label="List view"
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
            >
              <List />
            </Button>
          </div>
        </div>
        <div className="lab-tabs">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList aria-label="Media filter">
              <TabsTrigger value="all">All media</TabsTrigger>
              <TabsTrigger value="saved">Saved</TabsTrigger>
            </TabsList>
          </Tabs>
          <span className="lab-meta" role="status">
            {visible.length} items · Demo archive
          </span>
        </div>
        <div className={`lab-media-grid ${view === "list" ? "lab-list" : ""}`}>
          {visible.map((m, i) => (
            <Card key={m.title} className="lab-card">
              <div
                className={`lab-thumbnail lab-thumbnail-${i}`}
                style={{ aspectRatio: view === "list" ? "16 / 9" : m.ratio }}
              >
                <span className="magi-label">
                  Synthetic {m.ratio} placeholder
                </span>
                {m.kind === "Video" && <Play size={28} aria-hidden="true" />}
                <span className="lab-duration lab-meta">{m.duration}</span>
              </div>
              <CardContent className="lab-card-content">
                <div className="lab-card-kicker">
                  <Badge variant="secondary">{m.kind}</Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${saved.includes(m.title) ? "Unsave" : "Save"} ${m.title}`}
                    aria-pressed={saved.includes(m.title)}
                    onClick={() =>
                      setSaved((s) =>
                        s.includes(m.title)
                          ? s.filter((t) => t !== m.title)
                          : [...s, m.title],
                      )
                    }
                  >
                    <Bookmark
                      aria-hidden="true"
                      fill={saved.includes(m.title) ? "currentColor" : "none"}
                    />
                  </Button>
                </div>
                <h2 className="lab-media-title">{m.title}</h2>
                <p className="lab-description">{m.collection}</p>
                <p className="lab-meta">
                  {m.dimensions} · {m.date}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
        {!visible.length && (
          <p className="lab-empty-result" role="status">
            {tab === "saved"
              ? "Save a demo item to keep it here."
              : "No matching demo media."}
          </p>
        )}
        <footer className="lab-footer">
          <span className="lab-meta">
            No production data · exploratory composition
          </span>
          <span>Keep what moves you.</span>
        </footer>
      </div>
    </section>
  );
}
export function CollectionStudy(options: TypeOptions) {
  const [created, setCreated] = useState(false);
  return (
    <section className="lab-collection" style={typeStyle(options)}>
      <p className="magi-label">Collections / 001</p>
      <header className="lab-header">
        <div>
          <h1 className="lab-editorial">The space between.</h1>
          <p className="lab-description">
            A collection for the moments that ask you to slow down.
          </p>
          <p className="lab-meta">
            Private collection · {created ? "1 demo note" : "0 items"} · Updated
            just now
          </p>
        </div>
        <Badge variant="outline">Only you</Badge>
      </header>
      <Card className="lab-empty">
        <CardContent>
          <Folder size={32} aria-hidden="true" />
          <h2 className="lab-editorial">Leave room for discovery.</h2>
          <p className="lab-description">
            Save a first fragment. Let the rest find its way here.
          </p>
          <Button onClick={() => setCreated(!created)}>
            <Plus aria-hidden="true" />
            {created ? "Reset demo collection" : "Add demo note"}
          </Button>
          {created && (
            <p role="status">Demo note added locally. No media was uploaded.</p>
          )}
        </CardContent>
      </Card>
      <footer className="lab-footer">
        <span className="lab-meta">Synthetic collection / no API calls</span>
        <ArrowUpRight aria-hidden="true" size={16} />
      </footer>
    </section>
  );
}
