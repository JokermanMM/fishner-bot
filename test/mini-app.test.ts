import assert from "node:assert/strict";
import test from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { FishingRepository } from "../src/db.js";
import { MiniAppHandler } from "../src/mini-app.js";

function fakeResponse() {
  const result = { status: 0, headers: {} as Record<string, string>, body: "" };
  const response = {
    writeHead(status: number, headers?: Record<string, string>) {
      result.status = status;
      result.headers = headers ?? {};
      return response;
    },
    end(body?: string | Buffer) {
      result.body = body == null ? "" : body.toString();
      return response;
    },
  } as unknown as ServerResponse;
  return { response, result };
}

test("Mini App отдаёт интерфейс, но закрывает API без Telegram initData", async () => {
  const repository = {} as FishingRepository;
  const handler = new MiniAppHandler(repository, "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdef");

  const page = fakeResponse();
  assert.equal(await handler.handle(
    { method: "HEAD", headers: {} } as IncomingMessage,
    page.response,
    new URL("https://fishner-bot.onrender.com/app"),
  ), true);
  assert.equal(page.result.status, 200);
  assert.match(page.result.headers["content-security-policy"] ?? "", /frame-ancestors https:\/\/web\.telegram\.org/u);

  const api = fakeResponse();
  assert.equal(await handler.handle(
    { method: "POST", headers: {} } as IncomingMessage,
    api.response,
    new URL("https://fishner-bot.onrender.com/api/mini-app/bootstrap"),
  ), true);
  assert.equal(api.result.status, 401);
  assert.match(api.result.body, /Откройте дневник/u);
});
