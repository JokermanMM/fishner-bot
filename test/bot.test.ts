import assert from "node:assert/strict";
import test from "node:test";
import { createFishingBot } from "../src/bot.js";
import type { FishingRepository } from "../src/db.js";
import type { CatchRecord } from "../src/types.js";

const catchRecord: CatchRecord = {
  id: "00000000-0000-0000-0000-000000000001",
  userId: 1,
  ownerName: "Михаил",
  speciesName: "Щука",
  weightGrams: 5000,
  lengthMm: 825,
  latitude: null,
  longitude: null,
  waterbody: null,
  caughtAt: "2026-10-07T04:42:00.000Z",
  lure: null,
  disposition: "released",
  notes: null,
  mediaType: null,
  telegramFileId: null,
  telegramFileUniqueId: null,
  createdAt: "2026-10-07T04:42:00.000Z",
};

function repositoryStub(): FishingRepository {
  return {
    upsertUser: async () => undefined,
    isApproved: async () => true,
    listTopCatches: async () => [catchRecord],
  } as unknown as FishingRepository;
}

test("просроченное подтверждение кнопки не блокирует переключение статистики", async () => {
  const bot = createFishingBot("123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdef", repositoryStub(), "Europe/Moscow", "invite-code");
  bot.botInfo = {
    id: 123456789,
    is_bot: true,
    first_name: "fishner-test",
    username: "fishner_test_bot",
    can_join_groups: false,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false,
  };
  const calls: string[] = [];
  bot.api.config.use(async (_previous, method) => {
    calls.push(method);
    if (method === "answerCallbackQuery") throw new Error("Bad Request: query is too old");
    return { ok: true, result: true } as never;
  });

  await bot.handleUpdate({
    update_id: 1,
    callback_query: {
      id: "callback-1",
      from: { id: 1, is_bot: false, first_name: "Михаил" },
      chat_instance: "chat-instance",
      data: "rank:all:l",
      message: {
        message_id: 10,
        date: 1,
        chat: { id: 1, type: "private", first_name: "Михаил" },
        text: "Старый рейтинг",
      },
    },
  });

  assert.equal(calls[0], "answerCallbackQuery");
  assert.ok(calls.includes("editMessageText"));
});
