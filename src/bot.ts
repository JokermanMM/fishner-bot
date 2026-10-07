import {
  Bot,
  Context,
  InlineKeyboard,
  InlineQueryResultBuilder,
} from "grammy";
import type { InlineQueryResult } from "grammy/types";
import { FishingRepository } from "./db.js";
import {
  formatBatchDraftCard,
  formatCatchCard,
  formatCatchLeaderboard,
  formatLeaderboard,
  formatRecords,
  formatSharedCard,
} from "./format.js";
import {
  catchLeaderboardKeyboard,
  dateKeyboard,
  dispositionKeyboard,
  filterPickerKeyboard,
  labels,
  locationKeyboard,
  mainKeyboard,
  parseDisposition,
  previousLocationButtonLabel,
  previewKeyboard,
  savedCatchKeyboard,
  skipKeyboard,
  statsKeyboard,
} from "./keyboards.js";
import { normalizeSpeciesName, parseFishCount, parseLengthMm, parseRussianDate, parseWeightGrams } from "./parsers.js";
import type { CatchDraft, CatchLeaderboardMetric, CatchRecord, DraftRecord, DraftStep } from "./types.js";

const privateOnly = "🎣 Добавление улова доступно в личном чате с ботом. Так точная геопозиция останется приватной.";

function currentUser(ctx: Context): { id: number; firstName: string; username?: string } | null {
  if (!ctx.from) return null;
  return {
    id: ctx.from.id,
    firstName: ctx.from.first_name,
    ...(ctx.from.username ? { username: ctx.from.username } : {}),
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function fishProgress(data?: CatchDraft): string {
  const current = (data?.currentFishIndex ?? 0) + 1;
  const total = data?.fishCount ?? 1;
  return total > 1 ? ` <b>Рыба ${current} из ${total}.</b>` : "";
}

function nextPrompt(step: DraftStep, data?: CatchDraft, previousWaterbody?: string): { text: string; reply_markup?: ReturnType<typeof skipKeyboard> } {
  switch (step) {
    case "media": return { text: "📸 Пришлите фото или видео улова. Можно пропустить.", reply_markup: skipKeyboard() };
    case "count": return { text: "🔢 <b>Сколько рыб вы хотите внести?</b> Введите число от 1 до 20." };
    case "species": return { text: `🐟${fishProgress(data)} Что за рыба? Например: <b>щука</b>.` };
    case "weight": return { text: `⚖️${fishProgress(data)} Укажите вес: <b>4,85 кг</b> или <b>850 г</b>.` };
    case "length": return { text: `📏${fishProgress(data)} Какая длина? Например: <b>72 см</b>. Можно пропустить.`, reply_markup: skipKeyboard() };
    case "location": return { text: "📍 Отправьте точную геопозицию. Её смогут открыть друзья внутри бота, но она не попадёт в карточку для внешнего чата.", reply_markup: locationKeyboard(previousWaterbody) };
    case "waterbody": return { text: "🌊 Как называется водоём или место?", reply_markup: skipKeyboard() };
    case "caught_at": return { text: "📅 Когда была поймана рыба? Нажмите «Сейчас» или введите <b>27.10.2026 09:00</b> либо <b>27 октября 2026 г. в 09:00</b>.", reply_markup: dateKeyboard() };
    case "lure": return { text: "🎣 На что поймана? Например: <b>джиг, силикон 12 см</b>.", reply_markup: skipKeyboard() };
    case "disposition": return { text: "Что сделали с рыбой?", reply_markup: dispositionKeyboard() };
    case "notes": return { text: "✍️ Добавьте короткую историю или заметку.", reply_markup: skipKeyboard() };
    case "preview": return { text: "Проверьте карточку перед сохранением." };
  }
}

const orderedSteps: DraftStep[] = ["media", "count", "species", "weight", "length", "location", "waterbody", "caught_at", "lure", "disposition", "notes", "preview"];

function followingStep(step: DraftStep): DraftStep {
  const index = orderedSteps.indexOf(step);
  return orderedSteps[index + 1] ?? "preview";
}

async function sendPrompt(
  ctx: Context,
  repository: FishingRepository,
  userId: number,
  step: DraftStep,
  data?: CatchDraft,
): Promise<void> {
  const previousLocation = step === "location" ? await repository.getLastNamedLocation(userId) : null;
  const prompt = nextPrompt(step, data, previousLocation?.waterbody);
  await ctx.reply(prompt.text, { parse_mode: "HTML", ...(prompt.reply_markup ? { reply_markup: prompt.reply_markup } : {}) });
}

async function sendCard(ctx: Context, record: CatchRecord, caption: string, keyboard?: InlineKeyboard): Promise<void> {
  const options = { caption, parse_mode: "HTML" as const, ...(keyboard ? { reply_markup: keyboard } : {}) };
  if (record.mediaType === "photo" && record.telegramFileId) {
    await ctx.replyWithPhoto(record.telegramFileId, options);
  } else if (record.mediaType === "video" && record.telegramFileId) {
    await ctx.replyWithVideo(record.telegramFileId, options);
  } else {
    await ctx.reply(caption, { parse_mode: "HTML", ...(keyboard ? { reply_markup: keyboard } : {}) });
  }
}

async function showPreview(ctx: Context, repository: FishingRepository, draft: DraftRecord, timeZone: string): Promise<void> {
  const possibleRecordIndexes = new Set<number>();
  const fishes = draft.data.fishes ?? [];
  const maximumBySpecies = new Map<string, number>();
  for (const fish of fishes) {
    if (!fish.speciesName || !fish.weightGrams) continue;
    const normalizedName = fish.speciesName.toLocaleLowerCase("ru-RU");
    maximumBySpecies.set(normalizedName, Math.max(maximumBySpecies.get(normalizedName) ?? 0, fish.weightGrams));
  }
  for (const [index, fish] of fishes.entries()) {
    if (!fish.speciesName) continue;
    const best = await repository.getBestWeight(fish.speciesName);
    const weight = fish.weightGrams ?? 0;
    if (
      weight === maximumBySpecies.get(fish.speciesName.toLocaleLowerCase("ru-RU"))
      && (best == null || weight > best)
    ) possibleRecordIndexes.add(index);
  }
  const caption = formatBatchDraftCard(draft.data, timeZone, possibleRecordIndexes);
  const options = { caption, parse_mode: "HTML" as const, reply_markup: previewKeyboard() };
  const longCaption = caption.length > 900;
  if (draft.data.mediaType === "photo" && draft.data.telegramFileId) {
    if (longCaption) {
      await ctx.replyWithPhoto(draft.data.telegramFileId, { caption: "📸 Фото общего улова" });
      await ctx.reply(caption, { parse_mode: "HTML", reply_markup: previewKeyboard() });
    } else await ctx.replyWithPhoto(draft.data.telegramFileId, options);
  } else if (draft.data.mediaType === "video" && draft.data.telegramFileId) {
    if (longCaption) {
      await ctx.replyWithVideo(draft.data.telegramFileId, { caption: "🎥 Видео общего улова" });
      await ctx.reply(caption, { parse_mode: "HTML", reply_markup: previewKeyboard() });
    } else await ctx.replyWithVideo(draft.data.telegramFileId, options);
  } else {
    await ctx.reply(caption, { parse_mode: "HTML", reply_markup: previewKeyboard() });
  }
}

function metricFromToken(token: string | undefined): CatchLeaderboardMetric {
  return token === "l" ? "length" : "weight";
}

async function showCatchRanking(
  ctx: Context,
  repository: FishingRepository,
  timeZone: string,
  scope: "all" | "s" | "u",
  metric: CatchLeaderboardMetric,
  id?: number,
): Promise<void> {
  const filter = {
    metric,
    ...(scope === "s" && id != null ? { speciesId: id } : {}),
    ...(scope === "u" && id != null ? { userId: id } : {}),
  };
  let subject = "Все рыбы";
  if (scope === "s" && id != null) subject = await repository.getSpeciesFilterName(id) ?? "Неизвестный вид";
  if (scope === "u" && id != null) subject = await repository.getUserFilterName(id) ?? "Неизвестный рыбак";
  const metricLabel = metric === "weight" ? "по весу" : "по длине";
  const records = await repository.listTopCatches(filter);
  await ctx.editMessageText(formatCatchLeaderboard(records, timeZone, metric, `${subject}: ${metricLabel}`), {
    parse_mode: "HTML",
    reply_markup: catchLeaderboardKeyboard(scope, id),
  });
}

export function createFishingBot(
  token: string,
  repository: FishingRepository,
  timeZone: string,
  friendInviteCode: string,
): Bot {
  const bot = new Bot(token);

  bot.use(async (ctx, next) => {
    const user = currentUser(ctx);
    if (!user) return;
    await repository.upsertUser(user.id, user.firstName, user.username);

    const isStart = ctx.message?.text?.startsWith("/start") === true;
    if (isStart || await repository.isApproved(user.id)) {
      await next();
      return;
    }

    if (ctx.inlineQuery) {
      await ctx.answerInlineQuery([], { cache_time: 0, is_personal: true });
      return;
    }
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Нужна пригласительная ссылка", show_alert: true });
      return;
    }
    if (ctx.chat?.type === "private") {
      await ctx.reply("🔐 Это закрытый бот для нашей компании. Попросите у друга пригласительную ссылку.");
    }
  });

  bot.command("start", async (ctx) => {
    if (ctx.chat.type !== "private") {
      await ctx.reply(privateOnly);
      return;
    }
    const user = currentUser(ctx);
    if (!user) return;
    if (ctx.match === friendInviteCode) await repository.approveUser(user.id);
    if (!await repository.isApproved(user.id)) {
      await ctx.reply("🔐 Бот закрыт. Для входа нужна пригласительная ссылка от одного из участников.");
      return;
    }
    await ctx.reply(
      `🎣 <b>Наш рыболовный дневник</b>\n\nЗдесь собираются уловы, рекорды и статистика всей компании.\n\nДобавим новый улов?`,
      { parse_mode: "HTML", reply_markup: mainKeyboard() },
    );
  });

  bot.command("cancel", async (ctx) => {
    if (!ctx.from) return;
    await repository.clearDraft(ctx.from.id);
    await ctx.reply("Ввод улова отменён. Данные черновика удалены.", { reply_markup: mainKeyboard() });
  });

  bot.callbackQuery("draft:save", async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = currentUser(ctx);
    if (!user) return;
    const draft = await repository.getDraft(user.id);
    if (!draft || draft.step !== "preview") {
      await ctx.reply("Черновик уже сохранён или отменён.", { reply_markup: mainKeyboard() });
      return;
    }
    const saved = await repository.createCatchBatch(user.id, draft.data);
    const newRecordsCount = saved.filter((item) => item.isNewRecord).length;
    await ctx.editMessageReplyMarkup().catch(() => undefined);
    const summary = newRecordsCount > 0
      ? `✅ Сохранено рыб: ${saved.length}. 🏆 Новых рекордов: ${newRecordsCount}.`
      : `✅ Сохранено рыб: ${saved.length}.`;
    await ctx.reply(summary, {
      reply_markup: mainKeyboard(),
    });
    for (const [index, item] of saved.entries()) {
      const { record, isNewRecord } = item;
      const hasLocation = record.latitude != null && record.longitude != null;
      if (index === 0) {
        await sendCard(ctx, record, formatCatchCard(record, timeZone, isNewRecord), savedCatchKeyboard(record.id, hasLocation));
      } else {
        await ctx.reply(formatCatchCard(record, timeZone, isNewRecord), {
          parse_mode: "HTML",
          reply_markup: savedCatchKeyboard(record.id, hasLocation),
        });
      }
    }
  });

  bot.callbackQuery("draft:edit", async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = currentUser(ctx);
    if (!user) return;
    const draft = await repository.getDraft(user.id);
    if (!draft) return;
    const data = { ...draft.data, currentFishIndex: 0 };
    await repository.setDraft(user.id, "count", data);
    await ctx.editMessageReplyMarkup().catch(() => undefined);
    await ctx.reply("✏️ Пройдём поля ещё раз. Фото уже сохранено в черновике.");
    await sendPrompt(ctx, repository, user.id, "count", data);
  });

  bot.callbackQuery("draft:cancel", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.from) await repository.clearDraft(ctx.from.id);
    await ctx.editMessageReplyMarkup().catch(() => undefined);
    await ctx.reply("Улов не сохранён.", { reply_markup: mainKeyboard() });
  });

  bot.callbackQuery(/^catch:location:([0-9a-f-]{36})$/u, async (ctx) => {
    const catchId = ctx.match[1];
    const user = currentUser(ctx);
    const record = catchId ? await repository.getCatch(catchId) : null;
    if (!user || !record || record.latitude == null || record.longitude == null) {
      await ctx.answerCallbackQuery({ text: "Точка этого улова недоступна", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.replyWithLocation(record.latitude, record.longitude);
  });

  bot.callbackQuery("rank:overview", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(formatLeaderboard(await repository.listLeaderboard()), {
      parse_mode: "HTML",
      reply_markup: statsKeyboard(),
    });
  });

  bot.callbackQuery(/^rank:pick:(s|u)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    const kind = ctx.match[1] === "u" ? "u" : "s";
    const options = kind === "s" ? await repository.listSpeciesFilters() : await repository.listUserFilters();
    const title = kind === "s" ? "🐟 Выберите вид рыбы" : "👤 Выберите рыбака";
    await ctx.editMessageText(options.length ? title : `${title}\n\nПока нет данных для выбора.`, {
      reply_markup: filterPickerKeyboard(kind, options),
    });
  });

  bot.callbackQuery(/^rank:all:(w|l)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showCatchRanking(ctx, repository, timeZone, "all", metricFromToken(ctx.match[1]));
  });

  bot.callbackQuery(/^rank:(s|u):(\d+):(w|l)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    const scope = ctx.match[1] === "u" ? "u" : "s";
    const id = Number(ctx.match[2]);
    await showCatchRanking(ctx, repository, timeZone, scope, metricFromToken(ctx.match[3]), id);
  });

  bot.on("inline_query", async (ctx) => {
    const query = ctx.inlineQuery.query.trim();
    const idMatch = query.match(/^catch:([0-9a-f-]{36})$/iu);
    const selected = idMatch?.[1] ? await repository.getCatch(idMatch[1]) : null;
    const records = idMatch?.[1]
      ? [selected].filter((item): item is CatchRecord => item != null)
      : await repository.listRecentCatches(10);

    const results: InlineQueryResult[] = [];
    for (const record of records) {
      const caption = formatSharedCard(record, timeZone, await repository.isRecord(record));
      const options = {
        title: `${record.speciesName} — ${(record.weightGrams / 1000).toLocaleString("ru-RU")} кг`,
        description: record.waterbody ?? "Личный улов",
        caption,
        parse_mode: "HTML" as const,
      };
      if (record.mediaType === "photo" && record.telegramFileId) {
        results.push(InlineQueryResultBuilder.photoCached(record.id, record.telegramFileId, options));
        continue;
      }
      if (record.mediaType === "video" && record.telegramFileId) {
        results.push(InlineQueryResultBuilder.videoCached(record.id, options.title, record.telegramFileId, {
          description: options.description,
          caption,
          parse_mode: "HTML",
        }));
        continue;
      }
      results.push(InlineQueryResultBuilder.article(record.id, options.title, { description: options.description })
        .text(caption, { parse_mode: "HTML" }));
    }
    await ctx.answerInlineQuery(results, { cache_time: 0, is_personal: true });
  });

  bot.on("message", async (ctx) => {
    const user = currentUser(ctx);
    if (!user) return;
    if (ctx.chat.type !== "private") return;

    const text = ctx.message.text?.trim();
    if (text === labels.cancel) {
      await repository.clearDraft(user.id);
      await ctx.reply("Ввод улова отменён.", { reply_markup: mainKeyboard() });
      return;
    }

    if (text === labels.add) {
      const data: CatchDraft = { caughtAt: nowIso(), disposition: "unknown", fishes: [], currentFishIndex: 0 };
      await repository.setDraft(user.id, "media", data);
      await sendPrompt(ctx, repository, user.id, "media", data);
      return;
    }

    if (text === labels.recent) {
      const records = await repository.listRecentCatches(5);
      if (records.length === 0) {
        await ctx.reply("📚 Общая лента пока пуста. Добавьте первый улов!", { reply_markup: mainKeyboard() });
        return;
      }
      await ctx.reply(`📚 <b>Последние уловы: ${records.length}</b>`, { parse_mode: "HTML" });
      for (const record of records) {
        const hasLocation = record.latitude != null && record.longitude != null;
        await sendCard(
          ctx,
          record,
          formatCatchCard(record, timeZone, await repository.isRecord(record)),
          savedCatchKeyboard(record.id, hasLocation),
        );
      }
      return;
    }

    if (text === labels.records) {
      await ctx.reply(formatRecords(await repository.listRecords(), timeZone), { parse_mode: "HTML", reply_markup: mainKeyboard() });
      return;
    }

    if (text === labels.stats) {
      const records = await repository.listTopCatches({ metric: "weight" });
      await ctx.reply(formatCatchLeaderboard(records, timeZone, "weight", "Все рыбы: по весу"), {
        parse_mode: "HTML",
        reply_markup: catchLeaderboardKeyboard("all"),
      });
      return;
    }

    const draft = await repository.getDraft(user.id);
    if (!draft) {
      await ctx.reply("Выберите действие в меню.", { reply_markup: mainKeyboard() });
      return;
    }

    const data: CatchDraft = {
      ...draft.data,
      fishes: draft.data.fishes?.map((fish) => ({ ...fish })) ?? [
        {
          ...(draft.data.speciesName ? { speciesName: draft.data.speciesName } : {}),
          ...(draft.data.weightGrams ? { weightGrams: draft.data.weightGrams } : {}),
          ...(draft.data.lengthMm ? { lengthMm: draft.data.lengthMm } : {}),
        },
      ],
      currentFishIndex: draft.data.currentFishIndex ?? 0,
      fishCount: draft.data.fishCount ?? 1,
    };
    const skip = text === labels.skip;
    let valid = true;
    let reusedPreviousLocation = false;

    switch (draft.step) {
      case "media": {
        const photo = ctx.message.photo?.at(-1);
        const video = ctx.message.video;
        if (photo) {
          data.mediaType = "photo";
          data.telegramFileId = photo.file_id;
          data.telegramFileUniqueId = photo.file_unique_id;
        } else if (video) {
          data.mediaType = "video";
          data.telegramFileId = video.file_id;
          data.telegramFileUniqueId = video.file_unique_id;
        } else if (!skip) valid = false;
        break;
      }
      case "count": {
        const count = text ? parseFishCount(text) : null;
        if (count) {
          data.fishCount = count;
          data.currentFishIndex = 0;
          data.fishes = Array.from({ length: count }, (_, index) => data.fishes?.[index] ?? {});
        } else valid = false;
        break;
      }
      case "species": {
        const species = text ? normalizeSpeciesName(text) : null;
        if (species) {
          const index = data.currentFishIndex ?? 0;
          const fish = data.fishes?.[index] ?? {};
          data.fishes ??= [];
          data.fishes[index] = { ...fish, speciesName: species };
        }
        else valid = false;
        break;
      }
      case "weight": {
        const weight = text ? parseWeightGrams(text) : null;
        if (weight) {
          const index = data.currentFishIndex ?? 0;
          const fish = data.fishes?.[index] ?? {};
          data.fishes ??= [];
          data.fishes[index] = { ...fish, weightGrams: weight };
        }
        else valid = false;
        break;
      }
      case "length": {
        const index = data.currentFishIndex ?? 0;
        const fish = data.fishes?.[index] ?? {};
        data.fishes ??= [];
        if (skip) {
          const { lengthMm: _ignored, ...withoutLength } = fish;
          data.fishes[index] = withoutLength;
        } else {
          const length = text ? parseLengthMm(text) : null;
          if (length) data.fishes[index] = { ...fish, lengthMm: length };
          else valid = false;
        }
        break;
      }
      case "location": {
        if (ctx.message.location) {
          data.latitude = ctx.message.location.latitude;
          data.longitude = ctx.message.location.longitude;
        } else if (!skip) {
          const previousLocation = await repository.getLastNamedLocation(user.id);
          if (previousLocation && text === previousLocationButtonLabel(previousLocation.waterbody)) {
            data.latitude = previousLocation.latitude;
            data.longitude = previousLocation.longitude;
            data.waterbody = previousLocation.waterbody;
            reusedPreviousLocation = true;
          } else valid = false;
        }
        break;
      }
      case "waterbody": {
        if (skip) delete data.waterbody;
        else if (text && text.length <= 120) data.waterbody = text;
        else valid = false;
        break;
      }
      case "caught_at": {
        const date = text === labels.now ? nowIso() : text ? parseRussianDate(text) : null;
        if (date) data.caughtAt = date;
        else valid = false;
        break;
      }
      case "lure": {
        if (skip) delete data.lure;
        else if (text && text.length <= 200) data.lure = text;
        else valid = false;
        break;
      }
      case "disposition": {
        const disposition = text ? parseDisposition(text) : null;
        if (disposition) data.disposition = disposition;
        else valid = false;
        break;
      }
      case "notes": {
        if (skip) delete data.notes;
        else if (text && text.length <= 800) data.notes = text;
        else valid = false;
        break;
      }
      case "preview": {
        await ctx.reply("Используйте кнопки под карточкой: сохранить, изменить или отменить.");
        return;
      }
    }

    if (!valid) {
      await ctx.reply("Не смог распознать значение. Попробуйте ещё раз 👇");
      await sendPrompt(ctx, repository, user.id, draft.step, data);
      return;
    }

    let next = followingStep(draft.step);
    if (draft.step === "location" && reusedPreviousLocation) next = "caught_at";
    if (draft.step === "length") {
      const currentIndex = data.currentFishIndex ?? 0;
      if (currentIndex + 1 < (data.fishCount ?? 1)) {
        data.currentFishIndex = currentIndex + 1;
        next = "species";
      }
    }
    await repository.setDraft(user.id, next, data);
    if (next === "preview") {
      const updated = await repository.getDraft(user.id);
      if (updated) await showPreview(ctx, repository, updated, timeZone);
    } else {
      if (next === "species") {
        const species = await repository.listSpecies(user.id);
        if (species.length > 0) {
          await ctx.reply(`Раньше вы добавляли: ${species.join(", ")}`);
        }
      }
      await sendPrompt(ctx, repository, user.id, next, data);
    }
  });

  bot.catch((error) => {
    console.error("Ошибка обработки Telegram update", error.error);
  });

  return bot;
}
