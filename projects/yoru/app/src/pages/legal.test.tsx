import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Router } from "wouter";
import { LegalPage } from "./legal";
import { legalDocuments, LEGAL_UPDATED } from "@/lib/legal-content";

afterEach(cleanup);

describe("public legal documents", () => {
  for (const kind of ["privacy", "terms"] as const) {
    it(`renders ${kind} without an authentication or API provider`, () => {
      const { container } = render(<Router base="/legal-test"><LegalPage kind={kind} /></Router>);
      const doc = legalDocuments[kind];
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(doc.title);
      expect(document.title).toBe(`${doc.title} · yoru`);
      expect(screen.getByText(`Last updated ${LEGAL_UPDATED}`)).toBeTruthy();
      expect(screen.getByTestId("alert-legal-disclaimer").textContent).toContain("not legal advice");
      expect(container.textContent).toContain("Mark Foster");
      expect(container.textContent).toContain("Delaware");
      expect(container.textContent).toContain("explicit opt-in");
      expect(container.textContent).toContain("not currently offered");
      expect(screen.getByTestId(`link-header-${kind}`).getAttribute("aria-current")).toBe("page");
      const footer = screen.getByRole("navigation", { name: "Legal" });
      expect(within(footer).getByText("Privacy").getAttribute("href")).toBe("/legal-test/privacy");
      expect(within(footer).getByText("Terms").getAttribute("href")).toBe("/legal-test/terms");
      expect(within(footer).getByText("Contact").getAttribute("href")).toBe("mailto:privacy@ayamai.io");
      const ids = doc.sections.map(s => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const section of doc.sections) {
        expect(screen.getByRole("heading", { name: section.title })).toBeTruthy();
        expect(container.querySelector(`#${section.id}`)).toBeTruthy();
        expect(screen.getByTestId(`link-toc-${section.id}`).getAttribute("href")).toBe(`#${section.id}`);
      }
      expect(container.querySelector("script, iframe, video")).toBeNull();
      const images = container.querySelectorAll("img");
      expect(images).toHaveLength(1);
      expect(images[0].getAttribute("src")).toMatch(/\/ui\/brand\/mark\.png$/);
      expect(images[0].getAttribute("alt")).toBe("");
    });
  }

  it("discloses retention and erasure limits instead of promising unsupported deletion", () => {
    const { container } = render(<LegalPage kind="privacy" />);
    const text = container.textContent ?? "";
    expect(text).toContain("request-driven cleanup");
    expect(text).toContain("Viewing-activity collection is enabled by default");
    expect(text).toContain("90 days");
    expect(text).toContain("does not currently delete the separate daily video-view records");
    expect(text).toContain("Full self-service account erasure");
    expect(text).toContain("seven days");
    expect(text).toContain("pageview collection must be reviewed and disclosed separately");
    expect(text).toContain("not an all-provider analytics or cookie-consent switch");
    expect(text).toContain("Clerk");
    expect(text).toContain("Cloudflare");
    expect(text).toContain("configured AWS deployment");
  });

  it("covers adult eligibility, rights, consent, reporting and mandatory consumer rights", () => {
    const { container } = render(<LegalPage kind="terms" />);
    const text = container.textContent ?? "";
    for (const phrase of ["at least 18", "necessary permission", "non-consensual intimate imagery",
      "sexual depictions of minors", "consented", "takedown requirements", "cannot lawfully be excluded"]) {
      expect(text).toContain(phrase);
    }
  });
});
