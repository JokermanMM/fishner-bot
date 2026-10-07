import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml, formatBatchDraftCard, formatCatchLeaderboard, formatWeight } from "../src/format.js";
import type { CatchRecord } from "../src/types.js";

test("вес форматируется по-русски", () => {
  assert.equal(formatWeight(850), "850 г");
  assert.equal(formatWeight(4000), "4 кг");
  assert.equal(formatWeight(4850), "4,85 кг");
});

test("HTML из пользовательских полей экранируется", () => {
  assert.equal(escapeHtml("Щука <5 кг & больше"), "Щука &lt;5 кг &amp; больше");
});

test("предпросмотр показывает несколько рыб в одном улове", () => {
  const card = formatBatchDraftCard({
    caughtAt: "2026-10-07T04:42:00.000Z",
    disposition: "released",
    fishes: [
      { speciesName: "Щука", weightGrams: 5000, lengthMm: 800 },
      { speciesName: "Окунь", weightGrams: 900 },
    ],
  }, "Europe/Moscow", new Set([0]));
  assert.match(card, /Улов: 2 рыбы/u);
  assert.match(card, /Щука — 5 кг/u);
  assert.match(card, /Окунь — 900 г/u);
  assert.match(card, /Возможен новый рекорд/u);
});

test("топ уловов умеет показывать длину", () => {
  const record: CatchRecord = {
    id: "00000000-0000-0000-0000-000000000001",
    userId: 1,
    ownerName: "Михаил",
    speciesName: "Щука",
    weightGrams: 5000,
    lengthMm: 825,
    latitude: null,
    longitude: null,
    waterbody: null,
    caughtAt: "2026-10-07T04:42:00.000Z",
    lure: null,
    disposition: "released",
    notes: null,
    mediaType: null,
    telegramFileId: null,
    telegramFileUniqueId: null,
    createdAt: "2026-10-07T04:42:00.000Z",
  };
  assert.match(formatCatchLeaderboard([record], "Europe/Moscow", "length", "Все рыбы"), /82,5 см/u);
});
