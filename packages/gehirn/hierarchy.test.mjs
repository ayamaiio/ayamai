import test from "node:test";
import assert from "node:assert/strict";

import { renderPage } from "./page.mjs";
import { SERVICES } from "./services.mjs";
import { groupServices, childProjects } from "./entry.mjs";

test("every service names a project", () => {
  for (const service of SERVICES) {
    assert.ok(service.project, `${service.id} has no project`);
  }
  const projects = new Set(SERVICES.map((service) => service.project));
  assert.ok(projects.has("platform"), "the platform owns services");
  assert.ok(projects.has("yoru"), "yoru owns services");
  assert.ok(!SERVICES.some((service) => service.id === "gb"), "the game boy row is gone");
});

test("services are grouped by their project", () => {
  const groups = groupServices([
    { id: "api", project: "yoru" },
    { id: "web", project: "yoru" },
    { id: "tasks", project: "platform" },
  ]);
  assert.deepEqual(groups.yoru.sort(), ["api", "web"]);
  assert.deepEqual(groups.platform, ["tasks"]);
});

test("children come back with what the page needs", () => {
  const children = childProjects();
  assert.ok(children.length >= 8, "the emulators are there");
  const azahar = children.find((child) => child.id === "azahar");
  assert.equal(azahar.parent, "gemu");
  assert.equal(azahar.displayId, "gemu/azahar");
  assert.ok(azahar.fork, "the fork is recorded");
  assert.ok(Array.isArray(azahar.systems));
  assert.equal(typeof azahar.patches, "number");
});

test("the page carries both views' furniture", () => {
  const html = renderPage({ hostname: "machine", phone: "phone", startedAt: Date.now() });
  for (const id of ["crumbs", "projects-label", "services-label", "all-services", "children-wrap", "work-wrap"]) {
    assert.ok(html.includes(`id="${id}"`), `#${id} is missing`);
  }
  assert.ok(html.includes("function currentProject()"), "the view is decided from the path");
});
