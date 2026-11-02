import { useClerk } from "@clerk/react";
import { Link, useLocation } from "wouter";
import { LogOut, Plus, UserRound } from "lucide-react";
import { Button } from "@workspace/ayamai-design-system/components/ui/button";
import { cn } from "@workspace/ayamai-design-system/lib/utils";
import { BrandMark } from "@/components/brand-mark";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Crisp sans wordmark: the original ayamai mark plus lowercase "ayamai". */
export function Brand({ compact = false }: { compact?: boolean; dark?: boolean }) {
  return <Link href="/" className="flex shrink-0 items-center gap-2 rounded-md" aria-label="yoru home" data-testid="link-brand">
    <BrandMark />
    {!compact && <span className="font-serif text-[13px] font-normal leading-none tracking-[0.42em] text-foreground">YORU</span>}
  </Link>;
}

const tab = (on: boolean) => cn(
  "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors sm:px-3",
  on ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
);

export function AppNav() {
  const { signOut } = useClerk();
  const [location] = useLocation();
  return <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between gap-2 border-b border-border bg-background/90 px-3 backdrop-blur-xl md:px-8">
    <Brand />
    <nav className="flex items-center gap-0.5" aria-label="Main">
      <Link href="/feed" className={tab(location === "/feed")} aria-current={location === "/feed" ? "page" : undefined} data-testid="link-feed">Watch</Link>
      <Link href="/library" className={tab(location === "/library")} aria-current={location === "/library" ? "page" : undefined} data-testid="link-library">Library</Link>
      <Link href="/albums" className={cn(tab(location === "/albums"), "hidden md:inline-flex")} aria-current={location === "/albums" ? "page" : undefined} data-testid="link-albums">Albums</Link>
      <Link href="/manga" className={tab(location === "/manga")} aria-current={location === "/manga" ? "page" : undefined} data-testid="link-manga">Manga</Link>
      <Link href="/videos" className={cn(tab(location === "/videos"), "hidden md:inline-flex")} aria-current={location === "/videos" ? "page" : undefined} data-testid="link-videos">Videos</Link>
      <Link href="/after-hours" className={cn(tab(location === "/after-hours"), "hidden md:inline-flex")} aria-current={location === "/after-hours" ? "page" : undefined} data-testid="link-after-hours">After Hours</Link>
      <Link href="/saved" className={tab(location === "/saved")} aria-current={location === "/saved" ? "page" : undefined} data-testid="link-saved">Saved</Link>
      <Link href="/labels" className={cn(tab(location === "/labels"), "hidden md:inline-flex")} aria-current={location === "/labels" ? "page" : undefined} data-testid="link-labels">Labels</Link>
    </nav>
    <div className="flex items-center gap-1">
      <Button asChild size="icon" aria-label="Create post" data-testid="link-create-post">
        <Link href="/library?create=1" onClick={() => { if (location === "/library") window.dispatchEvent(new Event("ayamai:create-post")); }}><Plus size={17} /></Link>
      </Button>
      <Button asChild variant={location === "/account" ? "secondary" : "ghost"} size="icon" aria-label="Account and privacy" data-testid="link-account">
        <Link href="/account"><UserRound size={17} /></Link>
      </Button>
      {import.meta.env.VITE_AYAMAI_DEV_AUTH_MODE !== "local-founder" &&
        <Button variant="ghost" size="icon" className="hidden sm:inline-flex" onClick={() => signOut({ redirectUrl: basePath || "/" })} aria-label="Sign out" data-testid="button-sign-out"><LogOut size={17} /></Button>}
      {import.meta.env.VITE_AYAMAI_DEV_AUTH_MODE === "local-founder" &&
        <span className="mr-1 rounded border border-primary/30 px-2 py-1 font-mono text-[9px] tracking-widest text-primary" data-testid="local-dev-indicator">LOCAL DEV</span>}
    </div>
  </header>;
}
