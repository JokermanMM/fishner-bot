import type {
  CatchDraft,
  CatchLeaderboardMetric,
  CatchRecord,
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

export function formatDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(iso));
}

function dispositionLabel(value: CatchDraft["disposition"]): string {
  if (value === "released") return "♻️ Отпущена";
  if (value === "kept") return "🧺 Забрана";
  return "❔ Не указано";
}

export function formatDraftCard(draft: CatchDraft, timeZone: string, possibleRecord: boolean): string {
  const lines = [
    `🐟 <b>${escapeHtml(draft.speciesName || "Рыба")}</b>`,
    `⚖️ <b>${formatWeight(draft.weightGrams || 0)}</b>${draft.lengthMm ? `   ·   📏 ${formatLength(draft.lengthMm)}` : ""}`,
  ];
  if (possibleRecord) lines.push("🏆 <b>Возможно, это новый рекорд компании!</b>");
  lines.push("");
  if (draft.waterbody) lines.push(`📍 <b>Место:</b> ${escapeHtml(draft.waterbody)}`);
  if (draft.caughtAt) lines.push(`📅 <b>Дата:</b> ${formatDate(draft.caughtAt, timeZone)}`);
  if (draft.latitude != null && draft.longitude != null) lines.push("🗺 <i>Точная точка доступна друзьям в боте</i>");
  if (draft.lure) lines.push(`🎣 <b>Приманка:</b> ${escapeHtml(draft.lure)}`);
  lines.push(dispositionLabel(draft.disposition));
  if (draft.notes) lines.push(`\n💬 <b>Заметка</b>\n<i>${escapeHtml(draft.notes)}</i>`);
  return lines.join("\n");
}

export function formatBatchDraftCard(
  draft: CatchDraft,
  timeZone: string,
  possibleRecordIndexes: Set<number>,
): string {
  const fishes = draft.fishes ?? [];
  const lines = [
    "🎣 <b>Предпросмотр улова</b>",
    `🐟 ${fishes.length} ${pluralizeFish(fishes.length)}`,
    "",
    ...fishes.flatMap((fish, index) => {
      const details = [
        `${index + 1}. <b>${escapeHtml(fish.speciesName || "Рыба")}</b>`,
        `   ⚖️ <b>${formatWeight(fish.weightGrams || 0)}</b>${fish.lengthMm ? `   ·   📏 ${formatLength(fish.lengthMm)}` : ""}`,
      ];
      if (possibleRecordIndexes.has(index)) details.push("   🏆 Возможен новый рекорд компании");
      return details;
    }),
  ];
  if (draft.waterbody) lines.push("", `📍 <b>Место:</b> ${escapeHtml(draft.waterbody)}`);
  if (draft.caughtAt) lines.push(`📅 <b>Дата:</b> ${formatDate(draft.caughtAt, timeZone)}`);
  if (draft.latitude != null && draft.longitude != null) lines.push("🗺 <i>Точная точка доступна друзьям в боте</i>");
  if (draft.lure) lines.push(`🎣 <b>Приманка:</b> ${escapeHtml(draft.lure)}`);
  lines.push(dispositionLabel(draft.disposition));
  if (draft.notes) lines.push(`\n💬 <b>Заметка</b>\n<i>${escapeHtml(draft.notes)}</i>`);
  return lines.join("\n");
}

function pluralizeFish(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return "рыб";
  if (last === 1) return "рыба";
  if (last >= 2 && last <= 4) return "рыбы";
  return "рыб";
}

export function formatCatchCard(record: CatchRecord, timeZone: string, isRecord: boolean): string {
  const card = formatDraftCard({
    speciesName: record.speciesName,
    weightGrams: record.weightGrams,
    ...(record.lengthMm == null ? {} : { lengthMm: record.lengthMm }),
    ...(record.latitude == null ? {} : { latitude: record.latitude }),
    ...(record.longitude == null ? {} : { longitude: record.longitude }),
    ...(record.waterbody == null ? {} : { waterbody: record.waterbody }),
    caughtAt: record.caughtAt,
    ...(record.lure == null ? {} : { lure: record.lure }),
    disposition: record.disposition,
    ...(record.notes == null ? {} : { notes: record.notes }),
  }, timeZone, isRecord);
  return `${card}\n\n──────────\n👤 <b>Рыбак:</b> ${escapeHtml(record.ownerName)}`;
}

export function formatSharedCard(record: CatchRecord, timeZone: string, isRecord: boolean): string {
  const lines = [
    `🐟 <b>${escapeHtml(record.speciesName)} — ${formatWeight(record.weightGrams)}</b>`,
  ];
  if (isRecord) lines.push("🏆 <b>Рекорд компании</b>");
  lines.push(`👤 ${escapeHtml(record.ownerName)}`);
  if (record.lengthMm) lines.push(`📏 ${formatLength(record.lengthMm)}`);
  lines.push(`📅 ${formatDate(record.caughtAt, timeZone)}`);
  if (record.waterbody) lines.push(`📍 ${escapeHtml(record.waterbody)}`);
  if (record.lure) lines.push(`🎣 ${escapeHtml(record.lure)}`);
  lines.push(dispositionLabel(record.disposition));
  if (record.notes) lines.push(`\n<i>${escapeHtml(record.notes)}</i>`);
  return lines.join("\n");
}

export function formatRecords(rows: RecordRow[], timeZone: string): string {
  if (rows.length === 0) return "🏆 Рекордов пока нет. Добавьте первый улов!";
  return [
    "🏆 <b>Рекорды компании</b>",
    "",
    ...rows.map((row, index) => `${index + 1}. <b>${escapeHtml(row.speciesName)}</b> — ${formatWeight(row.weightGrams)}\n   👤 ${escapeHtml(row.ownerName)} · ${formatDate(row.caughtAt, timeZone)}`),
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

export function formatCatchLeaderboard(
  records: CatchRecord[],
  metric: CatchLeaderboardMetric,
  title: string,
): string {
  if (records.length === 0) {
    return metric === "length"
      ? `📏 <b>${escapeHtml(title)}</b>\n\nНет уловов с указанной длиной.`
      : `⚖️ <b>${escapeHtml(title)}</b>\n\nПодходящих уловов пока нет.`;
  }
  const metricTitle = metric === "weight" ? "Рейтинг по весу" : "Рейтинг по длине";
  return [
    "🏆 <b>Лидерборд уловов</b>",
    `${metric === "weight" ? "⚖️" : "📏"} <b>${metricTitle}</b> · ${escapeHtml(title)}`,
    "",
    ...records.map((record, index) => {
      const value = metric === "weight"
        ? formatWeight(record.weightGrams)
        : formatLength(record.lengthMm ?? 0);
      const secondary = metric === "weight"
        ? record.lengthMm == null ? "" : `   ·   📏 ${formatLength(record.lengthMm)}`
        : `   ·   ⚖️ ${formatWeight(record.weightGrams)}`;
      return [
        `${placeLabel(index)} <b>${escapeHtml(record.speciesName)}</b>`,
        `   ${metric === "weight" ? "⚖️" : "📏"} <b>${value}</b>${secondary}`,
        `   👤 ${escapeHtml(record.ownerName)}`,
      ].join("\n");
    }),
  ].join("\n");
}

function placeLabel(index: number): string {
  if (index === 0) return "🥇";
  if (index === 1) return "🥈";
  if (index === 2) return "🥉";
  return `${index + 1}.`;
}
