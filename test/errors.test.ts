import assert from "node:assert/strict";
import test from "node:test";
import { isMessageNotModified, safeErrorMessage } from "../src/errors.js";

test("безопасный лог скрывает токены и учётные данные базы", () => {
  const message = safeErrorMessage(
    "Telegram 123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdef и postgresql://user:password@example.com/db",
  );
  assert.doesNotMatch(message, /ABCDEFGHIJKLMNOPQRSTUVWXYZ|user:password/u);
  assert.match(message, /BOT_TOKEN скрыт/u);
  assert.match(message, /учётные данные скрыты/u);
});

test("повторное нажатие активного фильтра распознаётся как безопасное", () => {
  assert.equal(isMessageNotModified({ description: "Bad Request: message is not modified" }), true);
  assert.equal(isMessageNotModified(new Error("network error")), false);
});
