import "dotenv/config";
export interface Config {
  botToken: string;
  databaseUrl: string;
  timeZone: string;
  botMode: "polling" | "webhook";
  friendInviteCode: string;
  webhookSecret: string;
  publicUrl?: string;
  port: number;
}

export function loadConfig(): Config {
  const botToken = process.env.BOT_TOKEN?.trim();
  if (!botToken) {
    throw new Error("BOT_TOKEN не задан. Скопируйте .env.example в .env и добавьте токен.");
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL не задан.");

  const friendInviteCode = process.env.FRIEND_INVITE_CODE?.trim();
  if (!friendInviteCode) throw new Error("FRIEND_INVITE_CODE не задан.");
  if (!/^[A-Za-z0-9_-]{8,64}$/u.test(friendInviteCode)) {
    throw new Error("FRIEND_INVITE_CODE должен состоять из 8–64 букв, цифр, _ и -.");
  }

  const botMode = process.env.BOT_MODE === "webhook" ? "webhook" : "polling";
  const webhookSecret = process.env.WEBHOOK_SECRET?.trim() || "";
  if (botMode === "webhook" && !/^[A-Za-z0-9_-]{16,256}$/u.test(webhookSecret)) {
    throw new Error("WEBHOOK_SECRET для webhook должен состоять из 16–256 букв, цифр, _ и -.");
  }

  const renderHostname = process.env.RENDER_EXTERNAL_HOSTNAME?.trim();
  const publicUrl = process.env.PUBLIC_URL?.trim() || (renderHostname ? `https://${renderHostname}` : undefined);
  if (botMode === "webhook" && !publicUrl) throw new Error("PUBLIC_URL или RENDER_EXTERNAL_HOSTNAME не задан.");

  const port = Number.parseInt(process.env.PORT || "3000", 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("PORT задан неверно.");

  return {
    botToken,
    databaseUrl,
    timeZone: process.env.TIME_ZONE?.trim() || "Europe/Moscow",
    botMode,
    friendInviteCode,
    webhookSecret,
    ...(publicUrl ? { publicUrl: publicUrl.replace(/\/$/u, "") } : {}),
    port,
  };
}
