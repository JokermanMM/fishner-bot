import http from "node:http";
import { once } from "node:events";
import { webhookCallback } from "grammy";
import { loadConfig } from "./config.js";
import { createPostgresPool, FishingRepository } from "./db.js";
import { createFishingBot } from "./bot.js";
import { safeErrorMessage } from "./errors.js";

const config = loadConfig();
const repository = new FishingRepository(createPostgresPool(config.databaseUrl));
await repository.migrate();

const bot = createFishingBot(config.botToken, repository, config.timeZone, config.friendInviteCode);
await bot.init();
await bot.api.setMyCommands([
  { command: "start", description: "Открыть главное меню" },
  { command: "cancel", description: "Отменить ввод улова" },
]);

let server: http.Server | undefined;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\nПолучен ${signal}, останавливаю бота…`);

  if (config.botMode === "polling") {
    await bot.stop().catch(() => undefined);
  }
  if (server) {
    server.close();
    await once(server, "close").catch(() => undefined);
  }
  await repository.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

if (config.botMode === "polling") {
  await bot.api.deleteWebhook({ drop_pending_updates: false });
  console.log(`🎣 @${bot.botInfo.username} запущен локально через polling`);
  await bot.start();
} else {
  const webhookPath = `/telegram/${config.webhookSecret}`;
  const telegramWebhook = webhookCallback(bot, "http", { timeoutMilliseconds: 9_000 });

  server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://localhost");
    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/health") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(request.method === "HEAD" ? undefined : JSON.stringify({ status: "ok" }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end("🎣 Fishing journal bot is running");
      return;
    }
    if (request.method !== "POST" || url.pathname !== webhookPath) {
      response.writeHead(404).end();
      return;
    }
    if (request.headers["x-telegram-bot-api-secret-token"] !== config.webhookSecret) {
      response.writeHead(401).end();
      return;
    }

    try {
      await telegramWebhook(request, response);
    } catch (error) {
      console.error(`Ошибка Telegram webhook: ${safeErrorMessage(error)}`);
      if (!response.headersSent) response.writeHead(500).end();
    }
  });

  server.listen(config.port, "0.0.0.0");
  await once(server, "listening");

  const webhookUrl = `${config.publicUrl}${webhookPath}`;
  await bot.api.setWebhook(webhookUrl, {
    secret_token: config.webhookSecret,
    allowed_updates: ["message", "callback_query", "inline_query"],
  });
  console.log(`🎣 @${bot.botInfo.username} слушает webhook на порту ${config.port}`);
}
