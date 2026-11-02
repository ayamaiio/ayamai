import { Link } from "wouter";
import { Info } from "lucide-react";
import { Badge } from "@workspace/ayamai-design-system/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ayamai-design-system/components/ui/alert";
import { Separator } from "@workspace/ayamai-design-system/components/ui/separator";
import { BrandMark } from "@/components/brand-mark";
import { usePageTitle } from "@/lib/page-title";
import { legalDocuments, LEGAL_UPDATED } from "@/lib/legal-content";
import "./legal.css";

type LegalKind = "privacy" | "terms";

export function LegalFooterLinks({ className = "" }: { className?: string }) {
  return <nav className={`flex flex-wrap gap-x-4 gap-y-2 ${className}`} aria-label="Legal">
    <Link href="/" className="hover:text-foreground" data-testid="link-legal-home">Home</Link>
    <Link href="/privacy" className="hover:text-foreground" data-testid="link-legal-privacy">Privacy</Link>
    <Link href="/terms" className="hover:text-foreground" data-testid="link-legal-terms">Terms</Link>
    <a href="mailto:privacy@ayamai.io" className="hover:text-foreground" data-testid="link-legal-contact">Contact</a>
  </nav>;
}

export function LegalPage({ kind }: { kind: LegalKind }) {
  const doc = legalDocuments[kind];
  usePageTitle(doc.title);
  return <div className="app-shell legal-page flex min-h-[100dvh] flex-col bg-background text-foreground">
    <header className="legal-header sticky top-0 z-40 flex h-16 items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur-xl md:px-8">
      <Link href="/" className="flex items-center gap-2 rounded-md" aria-label="ayamai home" data-testid="link-legal-brand">
        <BrandMark />
        <span className="legal-wordmark"><strong>AYAMAI</strong><small lang="ja">&#12450;&#12516;&#12510;&#12452;</small></span>
      </Link>
      <nav className="legal-tabs" aria-label="Legal documents">
        <Link href="/privacy" className={kind === "privacy" ? "legal-tab is-current" : "legal-tab"} aria-current={kind === "privacy" ? "page" : undefined} data-testid="link-header-privacy">Privacy</Link>
        <Link href="/terms" className={kind === "terms" ? "legal-tab is-current" : "legal-tab"} aria-current={kind === "terms" ? "page" : undefined} data-testid="link-header-terms">Terms</Link>
      </nav>
    </header>

    <main className="legal-main mx-auto w-full max-w-6xl flex-1 px-4 py-10 md:px-8 md:py-16">
      <div className="legal-intro flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono">01 / POLICY</Badge>
          <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Last updated {LEGAL_UPDATED}</span>
        </div>
        <h1 className="legal-title text-3xl font-semibold tracking-tight md:text-5xl">{doc.title}</h1>
        <p className="max-w-2xl text-base text-muted-foreground md:text-lg">{doc.intro}</p>
        <Alert className="max-w-2xl" data-testid="alert-legal-disclaimer">
          <Info size={16} aria-hidden="true" />
          <AlertTitle>Working draft</AlertTitle>
          <AlertDescription>Informational draft, not legal advice. Confirm it against actual service practices and applicable law before relying on it.</AlertDescription>
        </Alert>
      </div>

      <Separator className="my-10" />

      <div className="grid gap-10 md:grid-cols-[14rem_1fr]">
        <nav aria-label="On this page" className="legal-toc md:sticky md:top-20 md:self-start">
          <p className="mb-3 font-mono text-xs uppercase tracking-widest text-primary">On this page</p>
          <ol className="flex flex-col gap-2 text-sm">
            {doc.sections.map((s, i) => <li key={s.id}>
              <a href={`#${s.id}`} className="flex gap-2 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid={`link-toc-${s.id}`}>
                <span className="font-mono text-xs leading-5">{String(i + 1).padStart(2, "0")}</span><span>{s.title}</span>
              </a>
            </li>)}
          </ol>
        </nav>
        <article className="flex min-w-0 max-w-2xl flex-col gap-10">
          {doc.sections.map((s, i) => <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="scroll-mt-20">
            <span className="font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
            <h2 id={`${s.id}-title`} className="legal-section-title mt-1 text-xl font-semibold tracking-tight md:text-2xl">{s.title}</h2>
            <div className="mt-3 flex flex-col gap-3">
              {s.paragraphs.map((p, j) => <p key={j} className="text-sm leading-7 text-muted-foreground md:text-base">{p}</p>)}
            </div>
          </section>)}
          <p className="text-sm text-muted-foreground">Questions about this document? Write to <a href="mailto:privacy@ayamai.io" className="text-primary hover:underline">privacy@ayamai.io</a>.</p>
        </article>
      </div>
    </main>

    <footer className="legal-footer border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 text-xs text-muted-foreground md:flex-row md:justify-between md:px-8">
        <span>ayamai, for adults 18+.</span>
        <LegalFooterLinks />
      </div>
    </footer>
  </div>;
}

export function PrivacyPage() { return <LegalPage kind="privacy" />; }
export function TermsPage() { return <LegalPage kind="terms" />; }
