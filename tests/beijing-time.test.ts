import assert from "node:assert/strict";
import test from "node:test";

import { beijingDateKey, formatBeijingDate, formatBeijingDateTime, formatBeijingTime } from "../app/time.js";

test("formats UTC timestamps as Beijing time", () => {
  const utcTime = "2026-08-18T03:04:05.000Z";
  assert.equal(formatBeijingDateTime(utcTime), "2026-08-18 11:04:05");
  assert.equal(formatBeijingDate(utcTime), "2026-08-18");
  assert.equal(formatBeijingTime(utcTime), "11:04:05");
  assert.equal(beijingDateKey(utcTime), "2026-08-18");
});

test("uses the Beijing calendar date across UTC midnight", () => {
  assert.equal(formatBeijingDateTime("2026-08-18T17:30:00.000Z"), "2026-08-19 01:30:00");
  assert.equal(beijingDateKey("2026-08-18T17:30:00.000Z"), "2026-08-19");
});

test("renders invalid timestamps safely", () => {
  assert.equal(formatBeijingDateTime("not-a-date"), "—");
});
