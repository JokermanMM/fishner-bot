import { InlineKeyboard, Keyboard } from "grammy";
import type { Disposition } from "./types.js";

export const labels = {
  add: "➕ Добавить улов",
  recent: "📚 Общая лента",
  records: "🏆 Рекорды",
  stats: "📊 Статистика",
  skip: "Пропустить",
  now: "Сейчас",
  cancel: "❌ Отмена",
} as const;

export function mainKeyboard(): Keyboard {
  return new Keyboard()
    .text(labels.add)
    .row()
    .text(labels.recent)
    .text(labels.records)
    .row()
    .text(labels.stats)
    .resized()
    .persistent();
}

export function skipKeyboard(): Keyboard {
  return new Keyboard().text(labels.skip).text(labels.cancel).resized().oneTime();
}

export function dateKeyboard(): Keyboard {
  return new Keyboard().text(labels.now).row().text(labels.cancel).resized().oneTime();
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
    .text("🌍 Топ всех рыб", "rank:all:w")
    .row()
    .text("🐟 По виду", "rank:pick:s")
    .text("👤 По рыбаку", "rank:pick:u");
}

export function catchLeaderboardKeyboard(scope: "all" | "s" | "u", id?: number): InlineKeyboard {
  const prefix = scope === "all" ? "rank:all" : `rank:${scope}:${id}`;
  return new InlineKeyboard()
    .text("⚖️ По весу", `${prefix}:w`)
    .text("📏 По длине", `${prefix}:l`)
    .row()
    .text("🐟 Выбрать вид", "rank:pick:s")
    .text("👤 Выбрать рыбака", "rank:pick:u")
    .row()
    .text("🌍 Все рыбы", "rank:all:w")
    .text("↩️ Общая статистика", "rank:overview");
}

export function filterPickerKeyboard(
  kind: "s" | "u",
  options: Array<{ id: number; name: string }>,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  options.forEach((option, index) => {
    keyboard.text(option.name, `rank:${kind}:${option.id}:w`);
    if (index % 2 === 1) keyboard.row();
  });
  if (options.length % 2 === 1) keyboard.row();
  return keyboard.text("↩️ Общая статистика", "rank:overview");
}

export function savedCatchKeyboard(id: string, showLocation = false): InlineKeyboard {
  const keyboard = new InlineKeyboard().switchInline("📤 Поделиться", `catch:${id}`);
  if (showLocation) {
    keyboard.row().text("🗺 Точка улова", `catch:location:${id}`);
  }
  return keyboard;
}
