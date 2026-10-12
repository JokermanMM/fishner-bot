import assert from "node:assert/strict";
import test from "node:test";
import { labels, mainKeyboard } from "../src/keyboards.js";

test("главное меню открывает Mini App по HTTPS", () => {
  const keyboard = mainKeyboard("https://fishner-bot.onrender.com/app");
  const button = keyboard.keyboard.flat().find((item) => typeof item !== "string" && item.text === labels.app);
  assert.deepEqual(button, {
    text: labels.app,
    web_app: { url: "https://fishner-bot.onrender.com/app" },
  });
});
