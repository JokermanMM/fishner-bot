const DECIMAL_RE = /^(\d+(?:[.,]\d+)?)\s*(кг|г|kg|g)?$/iu;

export function parseFishCount(input: string): number | null {
  if (!/^\d+$/u.test(input.trim())) return null;
  const count = Number(input.trim());
  return Number.isSafeInteger(count) && count >= 1 && count <= 20 ? count : null;
}

export function parseWeightGrams(input: string): number | null {
  const match = input.trim().match(DECIMAL_RE);
  if (!match?.[1]) return null;

  const value = Number.parseFloat(match[1].replace(",", "."));
  const unit = match[2]?.toLowerCase();
  if (!Number.isFinite(value) || value <= 0) return null;

  const grams = unit === "г" || unit === "g" ? value : value * 1000;
  const rounded = Math.round(grams);
  return rounded > 0 && rounded <= 1_000_000 ? rounded : null;
}

export function parseLengthMm(input: string): number | null {
  const match = input.trim().match(/^(\d+(?:[.,]\d+)?)\s*(см|cm|мм|mm)?$/iu);
  if (!match?.[1]) return null;

  const value = Number.parseFloat(match[1].replace(",", "."));
  const unit = match[2]?.toLowerCase();
  if (!Number.isFinite(value) || value <= 0) return null;

  const millimeters = unit === "мм" || unit === "mm" ? value : value * 10;
  const rounded = Math.round(millimeters);
  return rounded > 0 && rounded <= 10_000 ? rounded : null;
}

export function parseRussianDate(input: string): string | null {
  const monthNames: Record<string, number> = {
    январь: 1, января: 1,
    февраль: 2, февраля: 2,
    март: 3, марта: 3,
    апрель: 4, апреля: 4,
    май: 5, мая: 5,
    июнь: 6, июня: 6,
    июль: 7, июля: 7,
    август: 8, августа: 8,
    сентябрь: 9, сентября: 9,
    октябрь: 10, октября: 10,
    ноябрь: 11, ноября: 11,
    декабрь: 12, декабря: 12,
  };
  const trimmed = input.trim().toLocaleLowerCase("ru-RU");
  const numeric = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(?:в\s+)?(\d{1,2}):(\d{2}))?$/u);
  const words = trimmed.match(/^(\d{1,2})\s+([а-яё]+)\s+(\d{4})(?:\s*(?:г\.?|года))?(?:\s+в\s+(\d{1,2}):(\d{2}))?$/u);
  if (!numeric && !words) return null;

  const match = numeric ?? words;
  if (!match) return null;
  const [, dayRaw, monthRaw, yearRaw, hourRaw = "12", minuteRaw = "00"] = match;
  const day = Number(dayRaw);
  const month = numeric ? Number(monthRaw) : monthNames[monthRaw ?? ""];
  const year = Number(yearRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);

  if (
    month == null || year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31 ||
    hour < 0 || hour > 23 || minute < 0 || minute > 59
  ) return null;

  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+03:00`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const actual = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (Number(actual.year) !== year || Number(actual.month) !== month || Number(actual.day) !== day) return null;
  return date.toISOString();
}

export function normalizeSpeciesName(input: string): string | null {
  const cleaned = input.trim().replace(/\s+/gu, " ");
  if (cleaned.length < 2 || cleaned.length > 80) return null;
  return cleaned.charAt(0).toLocaleUpperCase("ru-RU") + cleaned.slice(1).toLocaleLowerCase("ru-RU");
}
