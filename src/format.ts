import type {
  CatchDraft,
  CatchLeaderboardMetric,
  CatchRecord,
  CatchSessionRecord,
  LeaderboardRow,
  RecordRow,
} from "./types.js";

export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function formatWeight(grams: number): string {
  if (grams < 1000) return `${grams} г`;
  const kilograms = grams / 1000;
  const digits = grams % 1000 === 0 ? 0 : grams % 100 === 0 ? 1 : 2;
  return `${kilograms.toFixed(digits).replace(".", ",")} кг`;
}

export function formatLength(millimeters: number): string {
  const centimeters = millimeters / 10;
  return `${Number.isInteger(centimeters) ? centimeters : centimeters.toFixed(1).replace(".", ",")} см`;
}

export function formatDate(date: string, _timeZone?: string): string {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(year ?? 2000, (month ?? 1) - 1, day ?? 1, 12)));
}

function dispositionLabel(value: CatchDraft["disposition"]): string {
  if (value === "released") return "♻️ Отпущена";
  if (value === "kept") return "🧺 Забрана";
  return "❔ Не указано";
}

function pluralizeFish(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return "рыб";
  if (last === 1) return "рыба";
  if (last >= 2 && last <= 4) return "рыбы";
  return "рыб";
}

function pluralizePhoto(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return "фотографий";
  if (last === 1) return "фотография";
  if (last >= 2 && last <= 4) return "фотографии";
  return "фотографий";
}

export function formatBatchDraftCard(
  draft: CatchDraft,
  _timeZone: string,
  possibleRecordIndexes: Set<number>,
): string {
  const fishes = draft.fishes ?? [];
  const photos = draft.photos?.length ?? 0;
  const lines = [
    "🎣 <b>Предпросмотр улова</b>",
    `📷 ${photos} ${pluralizePhoto(photos)}   ·   🐟 ${fishes.length} ${pluralizeFish(fishes.length)}`,
    "",
    ...fishes.flatMap((fish, index) => {
      const details = [
        `${index + 1}. <b>${escapeHtml(fish.speciesName || "Рыба")}</b>`,
        `   👤 ${escapeHtml(fish.anglerName || "Рыбак не выбран")}`,
        `   ⚖️ <b>${formatWeight(fish.weightGrams || 0)}</b>${fish.lengthMm ? `   ·   📏 ${formatLength(fish.lengthMm)}` : ""}`,
      ];
      if (possibleRecordIndexes.has(index)) details.push("   🏆 Возможен новый рекорд компании");
      return details;
    }),
  ];
  if (draft.waterbody) lines.push("", `📍 <b>Место:</b> ${escapeHtml(draft.waterbody)}`);
  if (draft.caughtOn) lines.push(`📅 <b>Дата:</b> ${formatDate(draft.caughtOn)}`);
  if (draft.latitude != null && draft.longitude != null) lines.push("🗺 <i>Точная точка доступна друзьям в боте</i>");
  if (draft.lure) lines.push(`🎣 <b>Приманка:</b> ${escapeHtml(draft.lure)}`);
  lines.push(dispositionLabel(draft.disposition));
  if (draft.notes) lines.push(`\n💬 <b>Заметка</b>\n<i>${escapeHtml(draft.notes)}</i>`);
  return lines.join("\n");
}

export function formatSessionCard(session: CatchSessionRecord, recordIndexes = new Set<number>()): string {
  const lines = [
    "🎣 <b>Улов компании</b>",
    `📷 ${session.photos.length} ${pluralizePhoto(session.photos.length)}   ·   🐟 ${session.fishes.length} ${pluralizeFish(session.fishes.length)}`,
    "",
    ...session.fishes.flatMap((fish, index) => {
      const details = [
        `${index + 1}. <b>${escapeHtml(fish.speciesName)}</b> — <b>${formatWeight(fish.weightGrams)}</b>${fish.lengthMm ? ` · 📏 ${formatLength(fish.lengthMm)}` : ""}`,
        `   👤 ${escapeHtml(fish.ownerName)}`,
      ];
      if (recordIndexes.has(index)) details.push("   🏆 Рекорд компании");
      return details;
    }),
  ];
  lines.push("", `📅 <b>Дата:</b> ${formatDate(session.caughtOn)}`);
  if (session.waterbody) lines.push(`📍 <b>Место:</b> ${escapeHtml(session.waterbody)}`);
  if (session.latitude != null && session.longitude != null) lines.push("🗺 <i>Точная точка доступна друзьям в боте</i>");
  if (session.lure) lines.push(`🎣 <b>Приманка:</b> ${escapeHtml(session.lure)}`);
  lines.push(dispositionLabel(session.disposition));
  if (session.notes) lines.push(`\n💬 <b>Заметка</b>\n<i>${escapeHtml(session.notes)}</i>`);
  if (session.fishes.some((fish) => fish.userId !== session.createdByUserId)) {
    lines.push(`\n📝 <i>Запись добавил: ${escapeHtml(session.createdByName)}</i>`);
  }
  return lines.join("\n");
}

export function formatCatchCard(record: CatchRecord, _timeZone: string, isRecord: boolean): string {
  const lines = [
    `🐟 <b>${escapeHtml(record.speciesName)}</b>`,
    `⚖️ <b>${formatWeight(record.weightGrams)}</b>${record.lengthMm ? `   ·   📏 ${formatLength(record.lengthMm)}` : ""}`,
  ];
  if (isRecord) lines.push("🏆 <b>Рекорд компании</b>");
  lines.push("", `👤 <b>Поймал:</b> ${escapeHtml(record.ownerName)}`, `📅 <b>Дата:</b> ${formatDate(record.caughtOn)}`);
  if (record.waterbody) lines.push(`📍 <b>Место:</b> ${escapeHtml(record.waterbody)}`);
  if (record.lure) lines.push(`🎣 <b>Приманка:</b> ${escapeHtml(record.lure)}`);
  lines.push(dispositionLabel(record.disposition));
  if (record.notes) lines.push(`\n<i>${escapeHtml(record.notes)}</i>`);
  if (record.createdByUserId !== record.userId) lines.push(`\n📝 <i>Запись добавил: ${escapeHtml(record.createdByName)}</i>`);
  return lines.join("\n");
}

export function formatSharedCard(record: CatchRecord, _timeZone: string, isRecord: boolean): string {
  const lines = [`🐟 <b>${escapeHtml(record.speciesName)} — ${formatWeight(record.weightGrams)}</b>`];
  if (isRecord) lines.push("🏆 <b>Рекорд компании</b>");
  lines.push(`👤 ${escapeHtml(record.ownerName)}`);
  if (record.lengthMm) lines.push(`📏 ${formatLength(record.lengthMm)}`);
  lines.push(`📅 ${formatDate(record.caughtOn)}`);
  if (record.waterbody) lines.push(`📍 ${escapeHtml(record.waterbody)}`);
  if (record.lure) lines.push(`🎣 ${escapeHtml(record.lure)}`);
  lines.push(dispositionLabel(record.disposition));
  if (record.notes) lines.push(`\n<i>${escapeHtml(record.notes)}</i>`);
  return lines.join("\n");
}

export function formatRecords(rows: RecordRow[], _timeZone: string): string {
  if (rows.length === 0) return "🏆 Рекордов пока нет. Добавьте первый улов!";
  return [
    "🏆 <b>Рекорды компании</b>",
    "",
    ...rows.map((row, index) => `${index + 1}. <b>${escapeHtml(row.speciesName)}</b> — ${formatWeight(row.weightGrams)}\n   👤 ${escapeHtml(row.ownerName)} · ${formatDate(row.caughtOn)}`),
  ].join("\n");
}

export function formatLeaderboard(rows: LeaderboardRow[]): string {
  if (rows.length === 0) return "📊 Статистика пока пуста.";
  return [
    "📊 <b>Рейтинг рыбаков</b>",
    "<i>Общие результаты компании</i>",
    "",
    ...rows.map((row, index) => [
      `${placeLabel(index)} <b>${escapeHtml(row.ownerName)}</b>`,
      `   🐟 Уловов: <b>${row.catchesCount}</b>   ·   ⚖️ ${formatWeight(row.totalWeightGrams)}`,
      `   🧩 Видов: ${row.speciesCount}   ·   🏆 Рекордов: ${row.recordsCount}`,
    ].join("\n")),
  ].join("\n");
}

export function formatCatchLeaderboard(records: CatchRecord[], metric: CatchLeaderboardMetric, title: string): string {
  if (records.length === 0) {
    return metric === "length"
      ? `📏 <b>${escapeHtml(title)}</b>\n\nНет уловов с указанной длиной.`
      : `⚖️ <b>${escapeHtml(title)}</b>\n\nПодходящих уловов пока нет.`;
  }
  return [
    "🏆 <b>Лидерборд уловов</b>",
    `${metric === "weight" ? "⚖️" : "📏"} <b>${metric === "weight" ? "Рейтинг по весу" : "Рейтинг по длине"}</b> · ${escapeHtml(title)}`,
    "",
    ...records.map((record, index) => {
      const value = metric === "weight" ? formatWeight(record.weightGrams) : formatLength(record.lengthMm ?? 0);
      const secondary = metric === "weight"
        ? record.lengthMm == null ? "" : `   ·   📏 ${formatLength(record.lengthMm)}`
        : `   ·   ⚖️ ${formatWeight(record.weightGrams)}`;
      return `${placeLabel(index)} <b>${escapeHtml(record.speciesName)}</b>\n   ${metric === "weight" ? "⚖️" : "📏"} <b>${value}</b>${secondary}\n   👤 ${escapeHtml(record.ownerName)}`;
    }),
  ].join("\n");
}

function placeLabel(index: number): string {
  if (index === 0) return "🥇";
  if (index === 1) return "🥈";
  if (index === 2) return "🥉";
  return `${index + 1}.`;
}
