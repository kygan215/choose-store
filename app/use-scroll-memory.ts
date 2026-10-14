"use client";

import { useRef } from "react";

type ScrollPosition = { top: number; left: number };
type ScrollSnapshot = { viewport: ScrollPosition; containers: Map<string, ScrollPosition> };

export type ScrollMemoryOptions = { viewport?: boolean; containers?: boolean };
export type ScrollRestoreResult = {
  found: boolean;
  viewportRestored: boolean;
  missingContainers: string[];
};

export type ScrollMemory = {
  capture: (viewKey: string, scope?: ParentNode) => void;
  restore: (viewKey: string, scope?: ParentNode, options?: ScrollMemoryOptions) => ScrollRestoreResult;
  forget: (viewKey: string) => void;
};

// Use a stable, unique data-scroll-memory value on each independently scrolling area.
function scrollableAreas(scope: ParentNode): Map<string, HTMLElement> {
  const areas = new Map<string, HTMLElement>();
  for (const element of scope.querySelectorAll<HTMLElement>("[data-scroll-memory]")) {
    // Hidden tab panels stay mounted so their content survives navigation. Their
    // scroll offsets belong to another view and must not enter this snapshot.
    if (element.closest?.("[hidden]") || element.getClientRects?.().length === 0) continue;
    const name = element.dataset.scrollMemory?.trim();
    if (name) areas.set(name, element);
  }
  return areas;
}

export function createScrollMemory(): ScrollMemory {
  const snapshots = new Map<string, ScrollSnapshot>();

  return {
    capture(viewKey, scope) {
      if (typeof window === "undefined" || !viewKey) return;
      const containers = new Map<string, ScrollPosition>();
      for (const [name, element] of scrollableAreas(scope ?? document)) {
        containers.set(name, { top: element.scrollTop, left: element.scrollLeft });
      }
      snapshots.set(viewKey, {
        viewport: { top: window.scrollY, left: window.scrollX },
        containers,
      });
    },

    restore(viewKey, scope, options = {}) {
      const missingContainers: string[] = [];
      if (typeof window === "undefined" || !viewKey) {
        return { found: false, viewportRestored: false, missingContainers };
      }
      const snapshot = snapshots.get(viewKey);
      if (!snapshot) return { found: false, viewportRestored: false, missingContainers };

      if (options.containers !== false) {
        const areas = scrollableAreas(scope ?? document);
        for (const [name, position] of snapshot.containers) {
          const element = areas.get(name);
          if (!element) {
            missingContainers.push(name);
            continue;
          }
          element.scrollTop = position.top;
          element.scrollLeft = position.left;
        }
      }

      if (options.viewport !== false) {
        window.scrollTo({ top: snapshot.viewport.top, left: snapshot.viewport.left, behavior: "instant" });
      }
      return {
        found: true,
        viewportRestored: options.viewport !== false && Math.abs(window.scrollY - snapshot.viewport.top) < 2,
        missingContainers,
      };
    },

    forget(viewKey) {
      snapshots.delete(viewKey);
    },
  };
}

/** Capture before replacing a view; restore only after that view's content is ready. */
export function useScrollMemory(): ScrollMemory {
  const memory = useRef<ScrollMemory | null>(null);
  if (!memory.current) memory.current = createScrollMemory();
  return memory.current;
}
