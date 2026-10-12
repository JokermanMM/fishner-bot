import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import type { FishingRepository } from "./db.js";
import { safeErrorMessage } from "./errors.js";
import { validateTelegramWebAppData } from "./telegram-webapp-auth.js";

const webRoot = fileURLToPath(new URL("../web/", import.meta.url));
const assets = new Map([
  ["/app", { path: "index.html", type: "text/html; charset=utf-8" }],
  ["/app/", { path: "index.html", type: "text/html; charset=utf-8" }],
  ["/app/app.js", { path: "app.js", type: "text/javascript; charset=utf-8" }],
  ["/app/styles.css", { path: "styles.css", type: "text/css; charset=utf-8" }],
  ["/app/vendor/leaflet-1.9.4.js", { path: "vendor/leaflet-1.9.4.js", type: "text/javascript; charset=utf-8" }],
  ["/app/vendor/leaflet-1.9.4.css", { path: "vendor/leaflet-1.9.4.css", type: "text/css; charset=utf-8" }],
  ["/app/vendor/images/layers.png", { path: "vendor/images/layers.png", type: "image/png" }],
  ["/app/vendor/images/layers-2x.png", { path: "vendor/images/layers-2x.png", type: "image/png" }],
]);

const securityHeaders = {
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self' https://telegram.org",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https://*.tile.openstreetmap.org",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "frame-ancestors https://web.telegram.org https://*.telegram.org",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; "),
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const;

interface TelegramFileResult {
  ok: boolean;
  result?: { file_path?: string };
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    ...securityHeaders,
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function readInitData(request: IncomingMessage): string {
  const direct = request.headers["x-telegram-init-data"];
  if (typeof direct === "string") return direct;
  const authorization = request.headers.authorization;
  return authorization?.startsWith("tma ") ? authorization.slice(4) : "";
}

export class MiniAppHandler {
  constructor(
    private readonly repository: FishingRepository,
    private readonly botToken: string,
  ) {}

  async handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
    const asset = assets.get(url.pathname);
    if ((request.method === "GET" || request.method === "HEAD") && asset) {
      try {
        const content = await readFile(`${webRoot}${asset.path}`);
        response.writeHead(200, {
          ...securityHeaders,
          "cache-control": asset.path === "index.html" ? "no-cache" : "public, max-age=3600",
          "content-type": asset.type,
        });
        response.end(request.method === "HEAD" ? undefined : content);
      } catch (error) {
        console.error(`Не удалось отдать Mini App: ${safeErrorMessage(error)}`);
        response.writeHead(500).end();
      }
      return true;
    }

    if (request.method === "POST" && url.pathname === "/api/mini-app/bootstrap") {
      const session = await this.authorize(request, response);
      if (!session) return true;
      const catches = await this.repository.listRecentCatches(250);
      sendJson(response, 200, {
        viewer: {
          id: session.user.id,
          firstName: session.user.first_name,
          ...(session.user.photo_url ? { photoUrl: session.user.photo_url } : {}),
        },
        catches: catches.map((record) => ({
          id: record.id,
          ownerName: record.ownerName,
          speciesName: record.speciesName,
          weightGrams: record.weightGrams,
          lengthMm: record.lengthMm,
          latitude: record.latitude,
          longitude: record.longitude,
          waterbody: record.waterbody,
          caughtAt: record.caughtAt,
          lure: record.lure,
          disposition: record.disposition,
          notes: record.notes,
          mediaType: record.mediaType,
          hasMedia: Boolean(record.mediaType && record.telegramFileId),
        })),
      });
      return true;
    }

    const mediaMatch = url.pathname.match(/^\/api\/mini-app\/media\/([0-9a-f-]{36})$/u);
    if (request.method === "GET" && mediaMatch?.[1]) {
      const session = await this.authorize(request, response);
      if (!session) return true;
      const record = await this.repository.getCatch(mediaMatch[1]);
      if (!record?.telegramFileId || !record.mediaType) {
        sendJson(response, 404, { error: "Медиа не найдено" });
        return true;
      }
      try {
        const fileResponse = await fetch(
          `https://api.telegram.org/bot${this.botToken}/getFile?file_id=${encodeURIComponent(record.telegramFileId)}`,
        );
        const file = await fileResponse.json() as TelegramFileResult;
        if (!fileResponse.ok || !file.ok || !file.result?.file_path) throw new Error("Telegram не вернул путь к файлу");
        const download = await fetch(`https://api.telegram.org/file/bot${this.botToken}/${file.result.file_path}`);
        if (!download.ok) throw new Error(`Telegram вернул HTTP ${download.status} при загрузке файла`);
        const content = Buffer.from(await download.arrayBuffer());
        response.writeHead(200, {
          ...securityHeaders,
          "cache-control": "private, max-age=3600",
          "content-length": String(content.byteLength),
          "content-type": download.headers.get("content-type")
            ?? (record.mediaType === "video" ? "video/mp4" : "image/jpeg"),
        });
        response.end(content);
      } catch (error) {
        console.error(`Не удалось загрузить медиа Mini App: ${safeErrorMessage(error)}`);
        sendJson(response, 502, { error: "Не удалось загрузить медиа из Telegram" });
      }
      return true;
    }

    return false;
  }

  private async authorize(request: IncomingMessage, response: ServerResponse) {
    const session = validateTelegramWebAppData(readInitData(request), this.botToken);
    if (!session) {
      sendJson(response, 401, { error: "Откройте дневник кнопкой внутри Telegram" });
      return null;
    }
    if (!await this.repository.isApproved(session.user.id)) {
      sendJson(response, 403, { error: "Этот аккаунт не входит в компанию рыбаков" });
      return null;
    }
    return session;
  }
}
