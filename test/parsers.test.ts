import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSpeciesName, parseFishCount, parseLengthMm, parseRussianDate, parseWeightGrams } from "../src/parsers.js";

test("количество рыб ограничено разумным диапазоном", () => {
  assert.equal(parseFishCount("5"), 5);
  assert.equal(parseFishCount("0"), null);
  assert.equal(parseFishCount("21"), null);
  assert.equal(parseFishCount("2,5"), null);
});

test("вес понимает килограммы и граммы", () => {
  assert.equal(parseWeightGrams("4,85"), 4850);
  assert.equal(parseWeightGrams("4.85 кг"), 4850);
  assert.equal(parseWeightGrams("850 г"), 850);
  assert.equal(parseWeightGrams("0"), null);
});

test("длина понимает сантиметры и миллиметры", () => {
  assert.equal(parseLengthMm("72"), 720);
  assert.equal(parseLengthMm("72,5 см"), 725);
  assert.equal(parseLengthMm("725 мм"), 725);
});

test("дата проверяет календарные значения", () => {
  assert.equal(parseRussianDate("31.02.2026"), null);
  assert.equal(parseRussianDate("07.10.2026 07:42"), "2026-10-07T04:42:00.000Z");
});

test("вид рыбы нормализуется", () => {
  assert.equal(normalizeSpeciesName("  ЩУКА "), "Щука");
  assert.equal(normalizeSpeciesName(" "), null);
});
