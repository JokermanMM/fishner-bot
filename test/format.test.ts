import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml, formatWeight } from "../src/format.js";

test("вес форматируется по-русски", () => {
  assert.equal(formatWeight(850), "850 г");
  assert.equal(formatWeight(4000), "4 кг");
  assert.equal(formatWeight(4850), "4,85 кг");
});

test("HTML из пользовательских полей экранируется", () => {
  assert.equal(escapeHtml("Щука <5 кг & больше"), "Щука &lt;5 кг &amp; больше");
});
