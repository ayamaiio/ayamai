import { Link } from "wouter";
import { ArrowUpRight, Mail } from "lucide-react";
import { usePageTitle } from "@/lib/page-title";
import "./landing.css";

export function LandingPage() {
  usePageTitle("YORU");
  return <div className="app-shell landing-page min-h-[100dvh]">
    <header className="landing-header">
      <Link href="/sign-in" className="landing-enter-link" data-testid="link-header-sign-in">Enter <ArrowUpRight size={14} /></Link>
    </header>
    <main>
      <section className="landing-hero" aria-labelledby="hero-title">
        <div className="landing-hero-copy">
          <h1 id="hero-title">Y O R U</h1>
          <p className="landing-japanese" lang="ja">&#22812;</p>
          <p className="landing-subtitle">A quiet place to get lost.</p>
          <span className="landing-red-mark" aria-hidden="true" />
        </div>
        <div className="landing-portrait-wrap"><img className="landing-profile" src="/landing-glance.png" alt="An original pale blue-haired woman glances back from the shadows." /></div>
      </section>
    </main>
    <footer className="landing-footer">
      <span className="landing-age">18+</span>
      <nav aria-label="Footer">
        <Link href="/privacy" data-testid="link-footer-privacy">Privacy</Link>
        <Link href="/terms" data-testid="link-footer-terms">Terms</Link>
        <a href="mailto:contact@ayamai.io" data-testid="link-footer-contact"><Mail size={13} /> Contact</a>
      </nav>
      <a className="landing-legal" href="mailto:privacy@ayamai.io" data-testid="link-footer-privacy-email">Privacy contact</a>
    </footer>
  </div>;
}
