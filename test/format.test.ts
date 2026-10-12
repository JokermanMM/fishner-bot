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
    caughtOn: "2026-10-07",
    photos: [{ telegramFileId: "photo", telegramFileUniqueId: "unique" }],
    disposition: "released",
    fishes: [
      { anglerUserId: 1, anglerName: "Михаил", speciesName: "Щука", weightGrams: 5000, lengthMm: 800 },
      { anglerUserId: 2, anglerName: "Андрей", speciesName: "Окунь", weightGrams: 900 },
    ],
  }, "Europe/Moscow", new Set([0]));
  assert.match(card, /2 рыбы/u);
  assert.match(card, /Щука/u);
  assert.match(card, /5 кг/u);
  assert.match(card, /Окунь/u);
  assert.match(card, /900 г/u);
  assert.match(card, /Возможен новый рекорд/u);
});

test("топ уловов умеет показывать длину", () => {
  const record: CatchRecord = {
    id: "00000000-0000-0000-0000-000000000001",
    sessionId: "00000000-0000-0000-0000-000000000010",
    userId: 1,
    ownerName: "Михаил",
    createdByUserId: 2,
    createdByName: "Андрей",
    speciesName: "Щука",
    weightGrams: 5000,
    lengthMm: 825,
    latitude: null,
    longitude: null,
    waterbody: null,
    caughtOn: "2026-10-07",
    lure: null,
    disposition: "released",
    notes: null,
    photos: [],
    createdAt: "2026-10-07T04:42:00.000Z",
  };
  const leaderboard = formatCatchLeaderboard([record], "length", "Все рыбы");
  assert.match(leaderboard, /82,5 см/u);
  assert.match(leaderboard, /5 кг/u);
  assert.doesNotMatch(leaderboard, /2026|октябр|07:42/iu);
});
