import { InlineKeyboard, Keyboard } from "grammy";
import type { AnglerOption, CatchLeaderboardMetric, CatchSessionRecord, Disposition } from "./types.js";

export const labels = {
  add: "➕ Добавить улов",
  recent: "📚 Общая лента",
  records: "🏆 Рекорды",
  stats: "📊 Статистика",
  app: "🌊 Открыть дневник",
  skip: "Пропустить",
  today: "Сегодня",
  yesterday: "Вчера",
  photosDone: "✅ Фото добавлены",
  me: "👤 Я",
  sameAngler: "↩️ Тот же рыбак",
  cancel: "❌ Отмена",
} as const;

export function mainKeyboard(miniAppUrl?: string): Keyboard {
  const keyboard = new Keyboard()
    .text(labels.add)
    .row()
    .text(labels.recent)
    .text(labels.records)
    .row()
    .text(labels.stats);
  if (miniAppUrl) keyboard.row().webApp(labels.app, miniAppUrl);
  return keyboard
    .resized()
    .persistent();
}

export function skipKeyboard(): Keyboard {
  return new Keyboard().text(labels.skip).text(labels.cancel).resized().oneTime();
}

export function dateKeyboard(): Keyboard {
  return new Keyboard()
    .text(labels.today)
    .text(labels.yesterday)
    .row()
    .text(labels.cancel)
    .resized()
    .oneTime();
}

export function photoKeyboard(): Keyboard {
  return new Keyboard().text(labels.photosDone).row().text(labels.cancel).resized();
}

export function anglerButtonLabel(angler: AnglerOption): string {
  return angler.username ? `${angler.displayName} (@${angler.username})` : angler.displayName;
}

export function anglerKeyboard(anglers: AnglerOption[], currentUserId: number, includePrevious: boolean): Keyboard {
  const keyboard = new Keyboard().text(labels.me);
  if (includePrevious) keyboard.text(labels.sameAngler);
  keyboard.row();
  for (const angler of anglers.filter((item) => item.id !== currentUserId)) {
    keyboard.text(anglerButtonLabel(angler)).row();
  }
  return keyboard.text(labels.cancel).resized().oneTime();
}

export function previousLocationButtonLabel(waterbody: string): string {
  const compact = waterbody.trim().replace(/\s+/gu, " ");
  const visibleName = compact.length > 32 ? `${compact.slice(0, 31)}…` : compact;
  return `📌 Предыдущая геолокация (${visibleName})`;
}

export function locationKeyboard(previousWaterbody?: string): Keyboard {
  const keyboard = new Keyboard().requestLocation("📍 Отправить геопозицию").row();
  if (previousWaterbody) keyboard.text(previousLocationButtonLabel(previousWaterbody)).row();
  return keyboard
    .text(labels.skip)
    .text(labels.cancel)
    .resized()
    .oneTime();
}

export function dispositionKeyboard(): Keyboard {
  return new Keyboard()
    .text("♻️ Отпущена")
    .text("🧺 Забрана")
    .row()
    .text("❔ Не указывать")
    .text(labels.cancel)
    .resized()
    .oneTime();
}

export function parseDisposition(text: string): Disposition | null {
  if (text === "♻️ Отпущена") return "released";
  if (text === "🧺 Забрана") return "kept";
  if (text === "❔ Не указывать") return "unknown";
  return null;
}

export function previewKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Сохранить", "draft:save")
    .text("✏️ Изменить", "draft:edit")
    .row()
    .text("❌ Отменить", "draft:cancel");
}

export function statsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🎣 К лидерборду уловов", "rank:all:w")
    .row()
    .text("🐟 Выбрать вид", "rank:pick:s")
    .text("👤 Выбрать рыбака", "rank:pick:u");
}

export function catchLeaderboardKeyboard(
  scope: "all" | "s" | "u",
  metric: CatchLeaderboardMetric,
  id?: number,
): InlineKeyboard {
  const prefix = scope === "all" ? "rank:all" : `rank:${scope}:${id}`;
  return new InlineKeyboard()
    .text(metric === "weight" ? "✅ Вес" : "⚖️ Вес", `${prefix}:w`)
    .text(metric === "length" ? "✅ Длина" : "📏 Длина", `${prefix}:l`)
    .row()
    .text(scope === "all" ? "✅ Все рыбы" : "🌍 Все рыбы", "rank:all:w")
    .row()
    .text("🐟 Выбрать вид", "rank:pick:s")
    .text("👤 Выбрать рыбака", "rank:pick:u")
    .row()
    .text("📊 Рейтинг рыбаков", "rank:overview");
}

export function filterPickerKeyboard(
  kind: "s" | "u",
  options: Array<{ id: number; name: string }>,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  options.forEach((option, index) => {
    keyboard.text(`• ${option.name}`, `rank:${kind}:${option.id}:w`);
    if (index % 2 === 1) keyboard.row();
  });
  if (options.length % 2 === 1) keyboard.row();
  return keyboard
    .text("🌍 Все рыбы", "rank:all:w")
    .row()
    .text("📊 Рейтинг рыбаков", "rank:overview");
}

export function savedCatchKeyboard(id: string, sessionId: string, showLocation = false): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .switchInline("📤 Поделиться", `catch:${id}`)
    .text("✏️ Управлять", `m:s:${sessionId}`);
  if (showLocation) {
    keyboard.row().text("🗺 Точка улова", `catch:location:${id}`);
  }
  return keyboard;
}

export function managementKeyboard(session: CatchSessionRecord): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text("📅 Дата", `m:d:${session.id}`)
    .text("📍 Место", `m:l:${session.id}`)
    .row()
    .text(`📷 Фотографии · ${session.photos.length}`, `m:p:${session.id}`)
    .row();
  session.fishes.forEach((fish, index) => keyboard.text(`🐟 ${index + 1}. ${fish.speciesName}`, `m:f:${fish.id}`).row());
  return keyboard.text("🗑 Удалить весь улов", `m:sd:${session.id}`).row().text("✅ Готово", "m:done");
}

export function fishManagementKeyboard(fishId: string, sessionId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("🐟 Вид", `m:fs:${fishId}`)
    .text("👤 Рыбак", `m:fa:${fishId}`)
    .row()
    .text("⚖️ Вес", `m:fw:${fishId}`)
    .text("📏 Длина", `m:fl:${fishId}`)
    .row()
    .text("🗑 Удалить рыбу", `m:fd:${fishId}`)
    .row()
    .text("← К улову", `m:s:${sessionId}`);
}

export function sessionDeleteConfirmationKeyboard(sessionId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("🗑 Да, удалить улов", `m:sdx:${sessionId}`)
    .row()
    .text("← Не удалять", `m:s:${sessionId}`);
}

export function fishDeleteConfirmationKeyboard(fishId: string, sessionId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("🗑 Да, удалить рыбу", `m:fdx:${fishId}`)
    .row()
    .text("← Не удалять", `m:f:${fishId}`)
    .text("К улову", `m:s:${sessionId}`);
}

export function photoManagementKeyboard(session: CatchSessionRecord): InlineKeyboard {
  return new InlineKeyboard()
    .text("➕ Добавить фотографии", `m:pa:${session.id}`)
    .row()
    .text("← К улову", `m:s:${session.id}`);
}

export function photoItemKeyboard(photoId: string, sessionId: string, isCover: boolean): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (!isCover) keyboard.text("⭐ Сделать обложкой", `m:pc:${photoId}`).row();
  return keyboard
    .text("🗑 Удалить фото", `m:pd:${photoId}`)
    .row()
    .text("← К фотографиям", `m:p:${sessionId}`);
}

export function photoDeleteConfirmationKeyboard(photoId: string, sessionId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("🗑 Да, удалить фото", `m:pdx:${photoId}`)
    .row()
    .text("← Не удалять", `m:p:${sessionId}`);
}
