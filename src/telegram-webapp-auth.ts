import { createHmac, timingSafeEqual } from "node:crypto";

export interface TelegramWebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

export interface TelegramWebAppSession {
  user: TelegramWebAppUser;
  authDate: number;
  queryId?: string;
}

export interface TelegramWebAppValidationOptions {
  nowSeconds?: number;
  maxAgeSeconds?: number;
}

function safeHexEqual(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/iu.test(left) || !/^[0-9a-f]{64}$/iu.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function validateTelegramWebAppData(
  initData: string,
  botToken: string,
  options: TelegramWebAppValidationOptions = {},
): TelegramWebAppSession | null {
  if (!initData || initData.length > 16_384) return null;
  const parameters = new URLSearchParams(initData);
  const receivedHash = parameters.get("hash");
  if (!receivedHash) return null;

  const dataCheckString = [...parameters.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (!safeHexEqual(receivedHash, expectedHash)) return null;

  const authDate = Number(parameters.get("auth_date"));
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxAgeSeconds = options.maxAgeSeconds ?? 86_400;
  if (!Number.isSafeInteger(authDate) || authDate <= 0 || authDate > nowSeconds + 60) return null;
  if (nowSeconds - authDate > maxAgeSeconds) return null;

  const rawUser = parameters.get("user");
  if (!rawUser) return null;
  try {
    const user = JSON.parse(rawUser) as Partial<TelegramWebAppUser>;
    if (!Number.isSafeInteger(user.id) || !user.id || typeof user.first_name !== "string" || !user.first_name.trim()) {
      return null;
    }
    const queryId = parameters.get("query_id");
    return {
      user: user as TelegramWebAppUser,
      authDate,
      ...(queryId ? { queryId } : {}),
    };
  } catch {
    return null;
  }
}
