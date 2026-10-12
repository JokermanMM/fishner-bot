import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { validateTelegramWebAppData } from "../src/telegram-webapp-auth.js";

const token = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdef";

function signedInitData(authDate: number): string {
  const parameters = new URLSearchParams({
    auth_date: String(authDate),
    query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
    user: JSON.stringify({ id: 42, first_name: "Михаил", username: "mike" }),
  });
  const dataCheckString = [...parameters.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(token).digest();
  parameters.set("hash", createHmac("sha256", secretKey).update(dataCheckString).digest("hex"));
  return parameters.toString();
}

test("Mini App принимает только подписанные свежие данные Telegram", () => {
  const session = validateTelegramWebAppData(signedInitData(1_800_000_000), token, {
    nowSeconds: 1_800_000_100,
  });
  assert.equal(session?.user.id, 42);
  assert.equal(session?.user.first_name, "Михаил");
  assert.equal(session?.queryId, "AAHdF6IQAAAAAN0XohDhrOrc");
});

test("Mini App отклоняет подменённые и устаревшие данные", () => {
  const valid = signedInitData(1_800_000_000);
  assert.equal(validateTelegramWebAppData(valid.replace("%D0%9C%D0%B8%D1%85%D0%B0%D0%B8%D0%BB", "%D0%90%D0%BD%D0%B4%D1%80%D0%B5%D0%B9"), token, {
    nowSeconds: 1_800_000_100,
  }), null);
  assert.equal(validateTelegramWebAppData(valid, token, {
    nowSeconds: 1_800_100_000,
    maxAgeSeconds: 86_400,
  }), null);
});
