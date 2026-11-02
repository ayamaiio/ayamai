import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Router } from "wouter";
import { LandingPage } from "./landing";

afterEach(cleanup);

describe("public ayamai landing page", () => {
  it("presents a quiet entry with a clear sign-in path and legal links", () => {
    const { container } = render(<Router base="/brand-test"><LandingPage /></Router>);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Y O R U");
    const enter = screen.getByRole("link", { name: /enter/i });
    expect(enter.getAttribute("href")).toBe("/brand-test/sign-in");
    expect(screen.getAllByRole("link", { name: /enter/i })).toHaveLength(1);
    expect(screen.getByRole("img", { name: /pale blue-haired woman/i }).getAttribute("src")).toBe("/landing-glance.png");
    expect(document.title).toBe("YORU · yoru");
    expect(screen.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/brand-test/privacy");
    expect(screen.getByRole("link", { name: "Terms" }).getAttribute("href")).toBe("/brand-test/terms");
    expect(container.textContent).toContain("夜");
    expect(container.textContent).toContain("A quiet place to get lost.");
    expect(container.textContent).toContain("18+");
    expect(container.textContent).not.toMatch(/hentai|adult animation|real-person media|invitation|library/i);
    expect(container.querySelector("video")).toBeNull();
  });
});
