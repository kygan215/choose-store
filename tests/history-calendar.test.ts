import assert from "node:assert/strict";
import test from "node:test";
import { calendarTags } from "../server/history-calendar.js";

test("official combined leave and lunar festival are distinct calendar facts", () => {
  const tags = calendarTags("2025-10-06", "2025-10-06");
  assert.ok(tags.includes("含2025年中秋节假期"));
  assert.ok(tags.includes("含2025年国庆节假期"));
  assert.ok(tags.includes("含2025年中秋节"));
});

test("weekend and a traditional festival are tagged from inclusive dates", () => {
  const tags = calendarTags("2026-06-19", "2026-06-21");
  assert.ok(tags.includes("含周末"));
  assert.ok(tags.includes("含2026年端午节假期"));
  assert.ok(tags.includes("含2026年端午节"));
});

test("leave spanning a Gregorian year retains its official holiday year", () => {
  assert.ok(calendarTags("2022-12-31", "2022-12-31").includes("含2023年元旦假期"));
});

test("unknown annual leave schedules are not guessed", () => {
  assert.ok(!calendarTags("2027-01-01", "2027-01-01").some((tag) => tag.endsWith("假期")));
});

test("invalid and inverted date ranges are rejected", () => {
  assert.throws(() => calendarTags("2025-02-30", "2025-03-02"));
  assert.throws(() => calendarTags("2025-03-02", "2025-03-01"));
});
