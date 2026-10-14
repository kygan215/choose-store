import assert from "node:assert/strict";
import test from "node:test";
import { createScrollMemory } from "../app/use-scroll-memory";

function area(name: string, top: number, left = 0) {
  return { dataset: { scrollMemory: name }, scrollTop: top, scrollLeft: left };
}

function scope(elements: ReturnType<typeof area>[]): ParentNode {
  return { querySelectorAll: () => elements } as unknown as ParentNode;
}

test("scroll memory restores only the requested view and named containers", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const viewport = {
    scrollX: 0,
    scrollY: 640,
    scrollTo(position: ScrollToOptions) {
      this.scrollX = position.left ?? 0;
      this.scrollY = position.top ?? 0;
    },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: viewport });

  try {
    const memory = createScrollMemory();
    memory.capture("brands", scope([area("brand-results", 290), area("brand-filters", 48)]));
    viewport.scrollY = 40;

    const unseen = memory.restore("jobs", scope([area("brand-results", 0)]));
    assert.equal(unseen.found, false);
    assert.equal(viewport.scrollY, 40);

    const newResults = area("brand-results", 0);
    const restored = memory.restore("brands", scope([newResults]));
    assert.equal(restored.found, true);
    assert.equal(restored.viewportRestored, true);
    assert.deepEqual(restored.missingContainers, ["brand-filters"]);
    assert.equal(viewport.scrollY, 640);
    assert.equal(newResults.scrollTop, 290);

    viewport.scrollY = 950; // An intentional navigation may keep its new viewport.
    newResults.scrollTop = 0;
    const containersOnly = memory.restore("brands", scope([newResults]), { viewport: false });
    assert.equal(viewport.scrollY, 950);
    assert.equal(newResults.scrollTop, 290);
    assert.equal(containersOnly.viewportRestored, false);

    memory.forget("brands");
    assert.equal(memory.restore("brands", scope([newResults])).found, false);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("a hidden tab cannot overwrite visible scroll memory, and a clamped viewport can be retried", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let maxScroll = 1800;
  const viewport = {
    scrollX: 0,
    scrollY: 920,
    scrollTo(position: ScrollToOptions) {
      this.scrollX = position.left ?? 0;
      this.scrollY = Math.min(position.top ?? 0, maxScroll);
    },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: viewport });

  try {
    const memory = createScrollMemory();
    const jobs = { ...area("jobs-history", 240), getClientRects: () => [{ width: 1 }] };
    const hiddenExports = { ...area("batch-export-stores", 57), closest: () => ({ hidden: true }), getClientRects: () => [{ width: 1 }] };
    memory.capture("page:jobs", scope([jobs, hiddenExports]));
    hiddenExports.scrollTop = 0;

    viewport.scrollY = 0;
    maxScroll = 80; // The destination tab is still showing its short loading state.
    const early = memory.restore("page:jobs", scope([jobs]));
    assert.equal(early.viewportRestored, false);
    assert.equal(viewport.scrollY, 80);

    maxScroll = 1800; // Its rows have now rendered; the caller retries restoration.
    const ready = memory.restore("page:jobs", scope([jobs, hiddenExports]));
    assert.equal(ready.viewportRestored, true);
    assert.equal(viewport.scrollY, 920);
    assert.equal(jobs.scrollTop, 240);
    assert.deepEqual(ready.missingContainers, []);
    assert.equal(hiddenExports.scrollTop, 0);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
