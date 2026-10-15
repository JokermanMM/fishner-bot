import assert from "node:assert/strict";
import test from "node:test";
import { labels, mainKeyboard, savedCatchKeyboard, sessionDeleteConfirmationKeyboard } from "../src/keyboards.js";

test("главное меню открывает Mini App по HTTPS", () => {
  const keyboard = mainKeyboard("https://fishner-bot.onrender.com/app");
  const button = keyboard.keyboard.flat().find((item) => typeof item !== "string" && item.text === labels.app);
  assert.deepEqual(button, {
    text: labels.app,
    web_app: { url: "https://fishner-bot.onrender.com/app" },
  });
});

test("карточка улова открывает управление, а удаление требует подтверждения", () => {
  const sessionId = "00000000-0000-0000-0000-000000000010";
  const catchId = "00000000-0000-0000-0000-000000000001";
  const cardButtons = savedCatchKeyboard(catchId, sessionId, true).inline_keyboard.flat();
  assert.ok(cardButtons.some((button) => "callback_data" in button && button.callback_data === `m:s:${sessionId}`));

  const confirmationButtons = sessionDeleteConfirmationKeyboard(sessionId).inline_keyboard.flat();
  assert.ok(confirmationButtons.some((button) => "callback_data" in button && button.callback_data === `m:sdx:${sessionId}`));
  assert.ok(confirmationButtons.some((button) => "callback_data" in button && button.callback_data === `m:s:${sessionId}`));
});
