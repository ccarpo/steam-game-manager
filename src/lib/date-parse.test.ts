import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReleaseDate } from "./date-parse.ts";

test("parseReleaseDate_handles_known_steam_formats", () => {
  assert.equal(parseReleaseDate("2026-03-14"), "2026-03-14");
  assert.equal(parseReleaseDate("6 Aug, 2019"), "2019-08-06");
  assert.equal(parseReleaseDate("Aug 6, 2019"), "2019-08-06");
  assert.equal(parseReleaseDate("Jun 11, 2026"), "2026-06-11");
  assert.equal(parseReleaseDate("Aug 2026"), "2026-08-01");
  assert.equal(parseReleaseDate("2027"), "2027-01-01");
  assert.equal(parseReleaseDate("Q3 2026"), "2026-07-01");
});

test("parseReleaseDate_returns_null_for_unknown_or_vague", () => {
  assert.equal(parseReleaseDate(""), null);
  assert.equal(parseReleaseDate("Coming soon"), null);
  assert.equal(parseReleaseDate("To be announced"), null);
  assert.equal(parseReleaseDate("TBA"), null);
  assert.equal(parseReleaseDate(null as unknown as string), null);
});
