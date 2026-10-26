import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findPrivateTerms,
  parseTerms,
} from "../scripts/check-private-terms.mjs";

test("private terms are matched case-insensitively and reported by location only", () => {
  const terms = parseTerms("# comment\n\nsecret-host\n\\bacme\\b\n");
  const hits = findPrivateTerms(terms, [
    { where: "a.md", text: "fine\nSee Secret-Host.example\nfine" },
    { where: "b.mjs", text: "acmeish stays\nby ACME corp" },
    { where: "c.txt", text: "nothing here" },
  ]);
  assert.deepEqual(hits, ["a.md:2", "b.mjs:2"]);
  assert.ok(hits.every((hit) => !/secret-host|acme/i.test(hit)));
});
