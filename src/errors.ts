const BOT_TOKEN_PATTERN = /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/gu;
const DATABASE_CREDENTIALS_PATTERN = /(postgres(?:ql)?:\/\/)[^\s@]+@/giu;

function descriptionFromObject(error: object): string | null {
  if ("description" in error && typeof error.description === "string") return error.description;
  if ("message" in error && typeof error.message === "string") return error.message;
  return null;
}

export function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error
    ? error.message
    : typeof error === "object" && error != null
      ? descriptionFromObject(error) ?? "Неизвестная ошибка"
      : typeof error === "string" ? error : "Неизвестная ошибка";
  return raw
    .replace(BOT_TOKEN_PATTERN, "[BOT_TOKEN скрыт]")
    .replace(DATABASE_CREDENTIALS_PATTERN, "$1[учётные данные скрыты]@")
    .slice(0, 500);
}

export function isMessageNotModified(error: unknown): boolean {
  return safeErrorMessage(error).toLocaleLowerCase("en-US").includes("message is not modified");
}
