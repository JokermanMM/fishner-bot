import { Bot, Context, InlineKeyboard, InlineQueryResultBuilder } from "grammy";
import type { InlineQueryResult } from "grammy/types";
import { FishingRepository } from "./db.js";
import { isMessageNotModified, safeErrorMessage } from "./errors.js";
import {
  formatBatchDraftCard,
  formatCatchLeaderboard,
  formatLeaderboard,
  formatRecords,
  formatSessionCard,
  formatSharedCard,
} from "./format.js";
import {
  anglerButtonLabel,
  anglerKeyboard,
  catchLeaderboardKeyboard,
  dateKeyboard,
  dispositionKeyboard,
  filterPickerKeyboard,
  labels,
  locationKeyboard,
  mainKeyboard,
  parseDisposition,
  photoKeyboard,
  previousLocationButtonLabel,
  previewKeyboard,
  savedCatchKeyboard,
  skipKeyboard,
  statsKeyboard,
} from "./keyboards.js";
import { normalizeSpeciesName, parseFishCount, parseLengthMm, parseRussianDate, parseWeightGrams } from "./parsers.js";
import type {
  AnglerOption,
  CatchDraft,
  CatchLeaderboardMetric,
  CatchRecord,
  CatchSessionRecord,
  DraftRecord,
  DraftStep,
} from "./types.js";

const privateOnly = "🎣 Добавление улова доступно в личном чате с ботом. Так точная геопозиция останется приватной.";

function currentUser(ctx: Context): { id: number; firstName: string; lastName?: string; username?: string } | null {
  if (!ctx.from) return null;
  return {
    id: ctx.from.id,
    firstName: ctx.from.first_name,
    ...(ctx.from.last_name ? { lastName: ctx.from.last_name } : {}),
    ...(ctx.from.username ? { username: ctx.from.username } : {}),
  };
}

function fishProgress(data?: CatchDraft): string {
  const current = (data?.currentFishIndex ?? 0) + 1;
  const total = data?.fishCount ?? 1;
  return total > 1 ? ` <b>Рыба ${current} из ${total}.</b>` : "";
}

function dateInTimeZone(timeZone: string, offsetDays = 0): string {
  const value = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function nextPrompt(step: DraftStep, data?: CatchDraft, previousWaterbody?: string): { text: string; reply_markup?: InlineKeyboard | ReturnType<typeof skipKeyboard> } {
  switch (step) {
    case "media": return {
      text: "📸 <b>Добавьте фотографии улова</b>\n\nМожно отправить от 1 до 10 фото — одним альбомом или по одной. Когда закончите, нажмите «Фото добавлены». Видео не поддерживается.",
      reply_markup: photoKeyboard(),
    };
    case "count": return { text: "🔢 <b>Сколько рыб вы хотите внести?</b> Введите число от 1 до 20." };
    case "angler": return { text: `👤${fishProgress(data)} <b>Кто поймал эту рыбу?</b>\n\nВыберите друга или отправьте его @username.` };
    case "species": return { text: `🐟${fishProgress(data)} Что за рыба? Например: <b>щука</b>.` };
    case "weight": return { text: `⚖️${fishProgress(data)} Укажите вес: <b>4,85 кг</b> или <b>850 г</b>.` };
    case "length": return { text: `📏${fishProgress(data)} Какая длина? Например: <b>72 см</b>. Можно пропустить.`, reply_markup: skipKeyboard() };
    case "location": return { text: "📍 Отправьте точную геопозицию. Её смогут открыть друзья внутри бота, но она не попадёт во внешнюю карточку.", reply_markup: locationKeyboard(previousWaterbody) };
    case "waterbody": return { text: "🌊 Как называется водоём или место?", reply_markup: skipKeyboard() };
    case "caught_on": return { text: "📅 <b>Когда был улов?</b> Выберите день или введите <b>27.10.2026</b> либо <b>27 октября 2026 г.</b>", reply_markup: dateKeyboard() };
    case "lure": return { text: "🎣 На что поймана рыба? Например: <b>джиг, силикон 12 см</b>.", reply_markup: skipKeyboard() };
    case "disposition": return { text: "Что сделали с рыбой?", reply_markup: dispositionKeyboard() };
    case "notes": return { text: "✍️ Добавьте короткую историю или заметку.", reply_markup: skipKeyboard() };
    case "preview": return { text: "Проверьте карточку перед сохранением." };
  }
}

const orderedSteps: DraftStep[] = ["media", "count", "angler", "species", "weight", "length", "location", "waterbody", "caught_on", "lure", "disposition", "notes", "preview"];

function followingStep(step: DraftStep): DraftStep {
  const index = orderedSteps.indexOf(step);
  return orderedSteps[index + 1] ?? "preview";
}

async function sendPrompt(ctx: Context, repository: FishingRepository, userId: number, step: DraftStep, data?: CatchDraft): Promise<void> {
  const previousLocation = step === "location" ? await repository.getLastNamedLocation(userId) : null;
  const prompt = nextPrompt(step, data, previousLocation?.waterbody);
  if (step === "angler") {
    const anglers = await repository.listApprovedUsers();
    prompt.reply_markup = anglerKeyboard(anglers, userId, (data?.currentFishIndex ?? 0) > 0);
  }
  await ctx.reply(prompt.text, { parse_mode: "HTML", ...(prompt.reply_markup ? { reply_markup: prompt.reply_markup } : {}) });
}

function sessionFromRecords(records: CatchRecord[]): CatchSessionRecord {
  const first = records[0];
  if (!first) throw new Error("Улов не содержит рыб");
  return {
    id: first.sessionId,
    createdByUserId: first.createdByUserId,
    createdByName: first.createdByName,
    latitude: first.latitude,
    longitude: first.longitude,
    waterbody: first.waterbody,
    caughtOn: first.caughtOn,
    lure: first.lure,
    disposition: first.disposition,
    notes: first.notes,
    photos: first.photos,
    fishes: records,
    createdAt: first.createdAt,
  };
}

async function sendSessionCard(ctx: Context, session: CatchSessionRecord, caption: string, keyboard?: InlineKeyboard): Promise<void> {
  const cover = session.photos[0];
  const options = { caption, parse_mode: "HTML" as const, ...(keyboard ? { reply_markup: keyboard } : {}) };
  if (cover && caption.length <= 900) await ctx.replyWithPhoto(cover.telegramFileId, options);
  else {
    if (cover) await ctx.replyWithPhoto(cover.telegramFileId, { caption: `📸 Обложка улова · всего фото: ${session.photos.length}` });
    await ctx.reply(caption, { parse_mode: "HTML", ...(keyboard ? { reply_markup: keyboard } : {}) });
  }
}

async function showPreview(ctx: Context, repository: FishingRepository, draft: DraftRecord, timeZone: string): Promise<void> {
  const possibleRecordIndexes = new Set<number>();
  const maximumBySpecies = new Map<string, number>();
  for (const fish of draft.data.fishes ?? []) {
    if (!fish.speciesName || !fish.weightGrams) continue;
    const name = fish.speciesName.toLocaleLowerCase("ru-RU");
    maximumBySpecies.set(name, Math.max(maximumBySpecies.get(name) ?? 0, fish.weightGrams));
  }
  for (const [index, fish] of (draft.data.fishes ?? []).entries()) {
    if (!fish.speciesName) continue;
    const best = await repository.getBestWeight(fish.speciesName);
    const weight = fish.weightGrams ?? 0;
    if (weight === maximumBySpecies.get(fish.speciesName.toLocaleLowerCase("ru-RU")) && (best == null || weight > best)) possibleRecordIndexes.add(index);
  }
  const caption = formatBatchDraftCard(draft.data, timeZone, possibleRecordIndexes);
  const cover = draft.data.photos?.[0];
  const options = { caption, parse_mode: "HTML" as const, reply_markup: previewKeyboard() };
  if (cover && caption.length <= 900) await ctx.replyWithPhoto(cover.telegramFileId, options);
  else {
    if (cover) await ctx.replyWithPhoto(cover.telegramFileId, { caption: `📸 Обложка улова · всего фото: ${draft.data.photos?.length ?? 1}` });
    await ctx.reply(caption, { parse_mode: "HTML", reply_markup: previewKeyboard() });
  }
}

function metricFromToken(token: string | undefined): CatchLeaderboardMetric {
  return token === "l" ? "length" : "weight";
}

async function updateStatsMessage(ctx: Context, text: string, replyMarkup: InlineKeyboard): Promise<void> {
  const options = { parse_mode: "HTML" as const, reply_markup: replyMarkup };
  try {
    await ctx.editMessageText(text, options);
  } catch (error) {
    if (isMessageNotModified(error)) return;
    console.warn(`Не удалось обновить сообщение статистики: ${safeErrorMessage(error)}. Отправляю новое.`);
    await ctx.reply(text, options);
  }
}

async function showCatchRanking(ctx: Context, repository: FishingRepository, scope: "all" | "s" | "u", metric: CatchLeaderboardMetric, id?: number): Promise<void> {
  const filter = {
    metric,
    ...(scope === "s" && id != null ? { speciesId: id } : {}),
    ...(scope === "u" && id != null ? { userId: id } : {}),
  };
  let subject = "Все рыбы";
  if (scope === "s" && id != null) subject = await repository.getSpeciesFilterName(id) ?? "Неизвестный вид";
  if (scope === "u" && id != null) subject = await repository.getUserFilterName(id) ?? "Неизвестный рыбак";
  await updateStatsMessage(ctx, formatCatchLeaderboard(await repository.listTopCatches(filter), metric, subject), catchLeaderboardKeyboard(scope, metric, id));
}

export function createFishingBot(token: string, repository: FishingRepository, timeZone: string, friendInviteCode: string, miniAppUrl?: string): Bot {
  const bot = new Bot(token);
  const homeKeyboard = () => mainKeyboard(miniAppUrl);
  const queues = new Map<number, Promise<void>>();

  // Callback подтверждаем до очереди и любых запросов к базе.
  bot.use(async (ctx, next) => {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery().catch((error: unknown) => {
        console.warn(`Не удалось подтвердить кнопку Telegram: ${safeErrorMessage(error)}. Обработка продолжена.`);
      });
    }
    await next();
  });

  // Альбом приходит несколькими update: сериализация не даёт соседним фото перезаписать друг друга.
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const previous = queues.get(userId) ?? Promise.resolve();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => gate);
    queues.set(userId, tail);
    await previous.catch(() => undefined);
    try { await next(); } finally {
      release();
      if (queues.get(userId) === tail) queues.delete(userId);
    }
  });

  bot.use(async (ctx, next) => {
    const user = currentUser(ctx);
    if (!user) return;
    await repository.upsertUser(user.id, user.firstName, user.lastName, user.username);
    const isStart = ctx.message?.text?.startsWith("/start") === true;
    if (isStart || await repository.isApproved(user.id)) { await next(); return; }
    if (ctx.inlineQuery) { await ctx.answerInlineQuery([], { cache_time: 0, is_personal: true }); return; }
    if (ctx.callbackQuery) {
      if (ctx.chat?.type === "private") await ctx.reply("🔐 Для этих кнопок нужна пригласительная ссылка от одного из участников.");
      return;
    }
    if (ctx.chat?.type === "private") await ctx.reply("🔐 Это закрытый бот для нашей компании. Попросите у друга пригласительную ссылку.");
  });

  bot.command("start", async (ctx) => {
    if (ctx.chat.type !== "private") { await ctx.reply(privateOnly); return; }
    const user = currentUser(ctx);
    if (!user) return;
    if (ctx.match === friendInviteCode) await repository.approveUser(user.id);
    if (!await repository.isApproved(user.id)) { await ctx.reply("🔐 Бот закрыт. Для входа нужна пригласительная ссылка от одного из участников."); return; }
    await ctx.reply("🎣 <b>Наш рыболовный дневник</b>\n\nЗдесь собираются уловы, рекорды и статистика всей компании.\n\nДобавим новый улов?", { parse_mode: "HTML", reply_markup: homeKeyboard() });
  });

  bot.command("cancel", async (ctx) => {
    if (!ctx.from) return;
    await repository.clearDraft(ctx.from.id);
    await ctx.reply("Ввод улова отменён. Данные черновика удалены.", { reply_markup: homeKeyboard() });
  });

  bot.callbackQuery("draft:save", async (ctx) => {
    const user = currentUser(ctx);
    if (!user) return;
    const draft = await repository.getDraft(user.id);
    if (!draft || draft.step !== "preview") { await ctx.reply("Черновик уже сохранён или отменён.", { reply_markup: homeKeyboard() }); return; }
    const saved = await repository.createCatchBatch(user.id, draft.data);
    const records = saved.map((item) => item.record);
    const session = sessionFromRecords(records);
    const recordIndexes = new Set(saved.flatMap((item, index) => item.isNewRecord ? [index] : []));
    await ctx.editMessageReplyMarkup().catch(() => undefined);
    await ctx.reply(`✅ Улов сохранён: ${records.length} рыб, ${session.photos.length} фото${recordIndexes.size ? `, новых рекордов: ${recordIndexes.size}` : ""}.`, { reply_markup: homeKeyboard() });
    const first = records[0];
    if (first) await sendSessionCard(ctx, session, formatSessionCard(session, recordIndexes), savedCatchKeyboard(first.id, session.latitude != null && session.longitude != null));
  });

  bot.callbackQuery("draft:edit", async (ctx) => {
    const user = currentUser(ctx);
    if (!user) return;
    const draft = await repository.getDraft(user.id);
    if (!draft) return;
    const data = { ...draft.data, currentFishIndex: 0 };
    await repository.setDraft(user.id, "count", data);
    await ctx.editMessageReplyMarkup().catch(() => undefined);
    await ctx.reply("✏️ Пройдём поля ещё раз. Фотографии уже сохранены в черновике.");
    await sendPrompt(ctx, repository, user.id, "count", data);
  });

  bot.callbackQuery("draft:cancel", async (ctx) => {
    if (ctx.from) await repository.clearDraft(ctx.from.id);
    await ctx.editMessageReplyMarkup().catch(() => undefined);
    await ctx.reply("Улов не сохранён.", { reply_markup: homeKeyboard() });
  });

  bot.callbackQuery(/^catch:location:([0-9a-f-]{36})$/u, async (ctx) => {
    const record = ctx.match[1] ? await repository.getCatch(ctx.match[1]) : null;
    if (!record || record.latitude == null || record.longitude == null) { await ctx.reply("Точка этого улова недоступна."); return; }
    await ctx.replyWithLocation(record.latitude, record.longitude);
  });

  bot.callbackQuery("rank:overview", async (ctx) => updateStatsMessage(ctx, formatLeaderboard(await repository.listLeaderboard()), statsKeyboard()));
  bot.callbackQuery(/^rank:pick:(s|u)$/u, async (ctx) => {
    const kind = ctx.match[1] === "u" ? "u" : "s";
    const options = kind === "s" ? await repository.listSpeciesFilters() : await repository.listUserFilters();
    const title = kind === "s" ? "🐟 <b>Лидерборд по виду</b>\n\nВыберите рыбу:" : "👤 <b>Лидерборд по рыбаку</b>\n\nВыберите участника:";
    await updateStatsMessage(ctx, options.length ? title : `${title}\n\nПока нет данных для выбора.`, filterPickerKeyboard(kind, options));
  });
  bot.callbackQuery(/^rank:all:(w|l)$/u, async (ctx) => showCatchRanking(ctx, repository, "all", metricFromToken(ctx.match[1])));
  bot.callbackQuery(/^rank:(s|u):(\d+):(w|l)$/u, async (ctx) => showCatchRanking(ctx, repository, ctx.match[1] === "u" ? "u" : "s", metricFromToken(ctx.match[3]), Number(ctx.match[2])));

  bot.on("inline_query", async (ctx) => {
    const query = ctx.inlineQuery.query.trim();
    const idMatch = query.match(/^catch:([0-9a-f-]{36})$/iu);
    const selected = idMatch?.[1] ? await repository.getCatch(idMatch[1]) : null;
    const records = idMatch?.[1] ? [selected].filter((item): item is CatchRecord => item != null) : await repository.listRecentCatches(10);
    const results: InlineQueryResult[] = [];
    for (const record of records) {
      const caption = formatSharedCard(record, timeZone, await repository.isRecord(record));
      const title = `${record.speciesName} — ${(record.weightGrams / 1000).toLocaleString("ru-RU")} кг`;
      const cover = record.photos[0];
      if (cover) results.push(InlineQueryResultBuilder.photoCached(record.id, cover.telegramFileId, { title, description: record.waterbody ?? "Личный улов", caption, parse_mode: "HTML" }));
      else results.push(InlineQueryResultBuilder.article(record.id, title, { description: record.waterbody ?? "Личный улов" }).text(caption, { parse_mode: "HTML" }));
    }
    await ctx.answerInlineQuery(results, { cache_time: 0, is_personal: true });
  });

  bot.on("message", async (ctx) => {
    const user = currentUser(ctx);
    if (!user || ctx.chat.type !== "private") return;
    const text = ctx.message.text?.trim();
    if (text === labels.cancel) { await repository.clearDraft(user.id); await ctx.reply("Ввод улова отменён.", { reply_markup: homeKeyboard() }); return; }

    if (text === labels.add) {
      const data: CatchDraft = { caughtOn: dateInTimeZone(timeZone), disposition: "unknown", photos: [], fishes: [], currentFishIndex: 0 };
      await repository.setDraft(user.id, "media", data);
      await sendPrompt(ctx, repository, user.id, "media", data);
      return;
    }

    if (text === labels.recent) {
      const sessions = await repository.listRecentSessions(5);
      if (!sessions.length) { await ctx.reply("📚 Общая лента пока пуста. Добавьте первый улов!", { reply_markup: homeKeyboard() }); return; }
      await ctx.reply(`📚 <b>Последние уловы: ${sessions.length}</b>`, { parse_mode: "HTML" });
      for (const session of sessions) {
        const recordFlags = new Set<number>();
        for (const [index, fish] of session.fishes.entries()) if (await repository.isRecord(fish)) recordFlags.add(index);
        const first = session.fishes[0];
        await sendSessionCard(ctx, session, formatSessionCard(session, recordFlags), first ? savedCatchKeyboard(first.id, session.latitude != null && session.longitude != null) : undefined);
      }
      return;
    }
    if (text === labels.records) { await ctx.reply(formatRecords(await repository.listRecords(), timeZone), { parse_mode: "HTML", reply_markup: homeKeyboard() }); return; }
    if (text === labels.stats) {
      await ctx.reply(formatCatchLeaderboard(await repository.listTopCatches({ metric: "weight" }), "weight", "Все рыбы"), { parse_mode: "HTML", reply_markup: catchLeaderboardKeyboard("all", "weight") });
      return;
    }

    const draft = await repository.getDraft(user.id);
    if (!draft) { await ctx.reply("Выберите действие в меню.", { reply_markup: homeKeyboard() }); return; }
    const data: CatchDraft = {
      ...draft.data,
      photos: [...(draft.data.photos ?? [])],
      fishes: draft.data.fishes?.map((fish) => ({ ...fish })) ?? [],
      currentFishIndex: draft.data.currentFishIndex ?? 0,
      fishCount: draft.data.fishCount ?? 1,
    };
    const skip = text === labels.skip;
    let valid = true;
    let reusedPreviousLocation = false;

    switch (draft.step) {
      case "media": {
        const photo = ctx.message.photo?.at(-1);
        if (ctx.message.video) {
          await ctx.reply("Видео не поддерживается — пришлите фотографию.", { reply_markup: photoKeyboard() });
          return;
        }
        if (photo) {
          const exists = data.photos?.some((item) => item.telegramFileUniqueId === photo.file_unique_id);
          if (exists) { await ctx.reply(`Эта фотография уже добавлена. Сейчас фото: ${data.photos?.length ?? 0}.`, { reply_markup: photoKeyboard() }); return; }
          if ((data.photos?.length ?? 0) >= 10) { await ctx.reply("Можно добавить не больше 10 фотографий. Нажмите «Фото добавлены».", { reply_markup: photoKeyboard() }); return; }
          data.photos?.push({ telegramFileId: photo.file_id, telegramFileUniqueId: photo.file_unique_id });
          await repository.setDraft(user.id, "media", data);
          await ctx.reply(`📷 Добавлено фото: ${data.photos?.length ?? 0} из 10. Можно прислать ещё или нажать «Фото добавлены».`, { reply_markup: photoKeyboard() });
          return;
        }
        if (text === labels.photosDone && (data.photos?.length ?? 0) > 0) break;
        valid = false;
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
      case "angler": {
        const index = data.currentFishIndex ?? 0;
        const anglers = await repository.listApprovedUsers();
        let selected: AnglerOption | null = null;
        if (text === labels.me) selected = anglers.find((item) => item.id === user.id) ?? null;
        else if (text === labels.sameAngler && index > 0) {
          const previous = data.fishes?.[index - 1];
          if (previous?.anglerUserId && previous.anglerName) selected = { id: previous.anglerUserId, displayName: previous.anglerName, username: null };
        } else if (text) {
          selected = anglers.find((item) => anglerButtonLabel(item) === text) ?? null;
          if (!selected && text.startsWith("@")) selected = await repository.findApprovedUserByUsername(text);
        }
        if (selected) {
          data.fishes ??= [];
          data.fishes[index] = { ...(data.fishes[index] ?? {}), anglerUserId: selected.id, anglerName: selected.displayName };
        } else valid = false;
        break;
      }
      case "species": {
        const species = text ? normalizeSpeciesName(text) : null;
        if (species) { const index = data.currentFishIndex ?? 0; data.fishes ??= []; data.fishes[index] = { ...(data.fishes[index] ?? {}), speciesName: species }; }
        else valid = false;
        break;
      }
      case "weight": {
        const weight = text ? parseWeightGrams(text) : null;
        if (weight) { const index = data.currentFishIndex ?? 0; data.fishes ??= []; data.fishes[index] = { ...(data.fishes[index] ?? {}), weightGrams: weight }; }
        else valid = false;
        break;
      }
      case "length": {
        const index = data.currentFishIndex ?? 0;
        const fish = data.fishes?.[index] ?? {};
        data.fishes ??= [];
        if (skip) { const { lengthMm: _ignored, ...withoutLength } = fish; data.fishes[index] = withoutLength; }
        else { const length = text ? parseLengthMm(text) : null; if (length) data.fishes[index] = { ...fish, lengthMm: length }; else valid = false; }
        break;
      }
      case "location": {
        if (ctx.message.location) { data.latitude = ctx.message.location.latitude; data.longitude = ctx.message.location.longitude; }
        else if (!skip) {
          const previous = await repository.getLastNamedLocation(user.id);
          if (previous && text === previousLocationButtonLabel(previous.waterbody)) {
            data.latitude = previous.latitude; data.longitude = previous.longitude; data.waterbody = previous.waterbody; reusedPreviousLocation = true;
          } else valid = false;
        }
        break;
      }
      case "waterbody": if (skip) delete data.waterbody; else if (text && text.length <= 120) data.waterbody = text; else valid = false; break;
      case "caught_on": {
        const date = text === labels.today ? dateInTimeZone(timeZone) : text === labels.yesterday ? dateInTimeZone(timeZone, -1) : text ? parseRussianDate(text) : null;
        if (date) data.caughtOn = date; else valid = false;
        break;
      }
      case "lure": if (skip) delete data.lure; else if (text && text.length <= 200) data.lure = text; else valid = false; break;
      case "disposition": { const disposition = text ? parseDisposition(text) : null; if (disposition) data.disposition = disposition; else valid = false; break; }
      case "notes": if (skip) delete data.notes; else if (text && text.length <= 800) data.notes = text; else valid = false; break;
      case "preview": await ctx.reply("Используйте кнопки под карточкой: сохранить, изменить или отменить."); return;
    }

    if (!valid) {
      const message = draft.step === "angler"
        ? "Не нашёл этого рыбака среди участников. Он должен сначала открыть бота по пригласительной ссылке."
        : draft.step === "media" ? "Добавьте хотя бы одну фотографию, затем нажмите «Фото добавлены»." : "Не смог распознать значение. Попробуйте ещё раз 👇";
      await ctx.reply(message);
      await sendPrompt(ctx, repository, user.id, draft.step, data);
      return;
    }

    let next = followingStep(draft.step);
    if (draft.step === "location" && reusedPreviousLocation) next = "caught_on";
    if (draft.step === "length") {
      const currentIndex = data.currentFishIndex ?? 0;
      if (currentIndex + 1 < (data.fishCount ?? 1)) { data.currentFishIndex = currentIndex + 1; next = "angler"; }
    }
    await repository.setDraft(user.id, next, data);
    if (next === "preview") {
      const updated = await repository.getDraft(user.id);
      if (updated) await showPreview(ctx, repository, updated, timeZone);
    } else {
      if (next === "species") {
        const species = await repository.listSpecies(user.id);
        if (species.length > 0) await ctx.reply(`Раньше добавляли: ${species.join(", ")}`);
      }
      await sendPrompt(ctx, repository, user.id, next, data);
    }
  });

  bot.catch((error) => console.error(`Ошибка обработки Telegram update: ${safeErrorMessage(error.error)}`));
  return bot;
}
