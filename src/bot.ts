import { Bot, Context, InlineKeyboard, InlineQueryResultBuilder, Keyboard } from "grammy";
import type { InlineQueryResult } from "grammy/types";
import { FishingRepository } from "./db.js";
import { isMessageNotModified, safeErrorMessage } from "./errors.js";
import {
  escapeHtml,
  formatBatchDraftCard,
  formatCatchLeaderboard,
  formatDate,
  formatLeaderboard,
  formatLength,
  formatRecords,
  formatSessionCard,
  formatSharedCard,
  formatWeight,
} from "./format.js";
import {
  anglerButtonLabel,
  anglerKeyboard,
  catchLeaderboardKeyboard,
  dateKeyboard,
  dispositionKeyboard,
  filterPickerKeyboard,
  fishDeleteConfirmationKeyboard,
  fishManagementKeyboard,
  labels,
  locationKeyboard,
  mainKeyboard,
  managementKeyboard,
  parseDisposition,
  photoKeyboard,
  photoDeleteConfirmationKeyboard,
  photoItemKeyboard,
  photoManagementKeyboard,
  previousLocationButtonLabel,
  previewKeyboard,
  savedCatchKeyboard,
  sessionDeleteConfirmationKeyboard,
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
  ManagementDraft,
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

async function showManagement(ctx: Context, repository: FishingRepository, sessionId: string): Promise<void> {
  const session = await repository.getSession(sessionId);
  if (!session) {
    await ctx.reply("Этот улов уже удалён или не найден.");
    return;
  }
  await ctx.reply(`✏️ <b>Управление уловом</b>\n\n${formatSessionCard(session)}`, {
    parse_mode: "HTML",
    reply_markup: managementKeyboard(session),
  });
}

async function showFishManagement(ctx: Context, repository: FishingRepository, fishId: string): Promise<void> {
  const fish = await repository.getCatch(fishId);
  if (!fish) {
    await ctx.reply("Эта рыба уже удалена или не найдена.");
    return;
  }
  const details = [
    "🐟 <b>Управление рыбой</b>",
    "",
    `<b>${escapeHtml(fish.speciesName)}</b>`,
    `👤 ${escapeHtml(fish.ownerName)}`,
    `⚖️ ${formatWeight(fish.weightGrams)}${fish.lengthMm == null ? "" : ` · 📏 ${formatLength(fish.lengthMm)}`}`,
    `📅 ${formatDate(fish.caughtOn)}`,
  ].join("\n");
  await ctx.reply(details, { parse_mode: "HTML", reply_markup: fishManagementKeyboard(fish.id, fish.sessionId) });
}

async function showPhotoManagement(ctx: Context, repository: FishingRepository, sessionId: string): Promise<void> {
  const session = await repository.getSession(sessionId);
  if (!session) {
    await ctx.reply("Этот улов уже удалён или не найден.");
    return;
  }
  await ctx.reply(`📷 <b>Фотографии улова</b>\n\nСейчас: ${session.photos.length} из 10. Первая фотография используется как обложка.`, {
    parse_mode: "HTML",
    reply_markup: photoManagementKeyboard(session),
  });
  for (const [index, photo] of session.photos.entries()) {
    await ctx.replyWithPhoto(photo.telegramFileId, {
      caption: index === 0 ? `⭐ Обложка · фото 1 из ${session.photos.length}` : `Фото ${index + 1} из ${session.photos.length}`,
      reply_markup: photoItemKeyboard(photo.id, session.id, index === 0),
    });
  }
}

async function beginManagementEdit(
  ctx: Context,
  repository: FishingRepository,
  userId: number,
  draft: Omit<ManagementDraft, "userId" | "data"> & { data?: ManagementDraft["data"] },
  prompt: string,
  replyMarkup?: Keyboard,
): Promise<void> {
  await repository.clearDraft(userId);
  await repository.setManagementDraft(userId, draft.step, draft.sessionId, draft.fishId, draft.data ?? {});
  await ctx.reply(prompt, { parse_mode: "HTML", ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
}

async function resolveAngler(
  repository: FishingRepository,
  userId: number,
  text: string | undefined,
): Promise<AnglerOption | null> {
  if (!text) return null;
  const anglers = await repository.listApprovedUsers();
  if (text === labels.me) return anglers.find((item) => item.id === userId) ?? null;
  const selected = anglers.find((item) => anglerButtonLabel(item) === text);
  if (selected) return selected;
  return text.startsWith("@") ? repository.findApprovedUserByUsername(text) : null;
}

function editLocationKeyboard(): Keyboard {
  return new Keyboard()
    .requestLocation("📍 Отправить новую геопозицию")
    .row()
    .text(labels.cancel)
    .resized()
    .oneTime();
}

async function handleManagementInput(
  ctx: Context,
  repository: FishingRepository,
  userId: number,
  draft: ManagementDraft,
  timeZone: string,
  homeKeyboard: Keyboard,
): Promise<void> {
  const text = ctx.message?.text?.trim();
  const finish = async (message: string, sessionId = draft.sessionId): Promise<void> => {
    await repository.clearManagementDraft(userId);
    await ctx.reply(message, { reply_markup: homeKeyboard });
    await showManagement(ctx, repository, sessionId);
  };

  switch (draft.step) {
    case "session_date": {
      const date = text === labels.today
        ? dateInTimeZone(timeZone)
        : text === labels.yesterday
          ? dateInTimeZone(timeZone, -1)
          : text ? parseRussianDate(text) : null;
      if (!date) {
        await ctx.reply("Не распознал дату. Введите, например, <b>27.10.2026</b> или <b>27 октября 2026 г.</b>", { parse_mode: "HTML", reply_markup: dateKeyboard() });
        return;
      }
      if (!await repository.updateSessionDate(draft.sessionId, date)) { await finish("Улов уже удалён или не найден."); return; }
      await finish(`✅ Дата изменена: ${formatDate(date)}.`);
      return;
    }
    case "session_location": {
      const location = ctx.message?.location;
      if (location) {
        await repository.setManagementDraft(userId, "session_waterbody", draft.sessionId, null, {
          latitude: location.latitude,
          longitude: location.longitude,
        });
        await ctx.reply("🌊 Как называется новое место? Можно пропустить и сохранить прежнее название.", { reply_markup: skipKeyboard() });
        return;
      }
      if (!text || text.length > 120) {
        await ctx.reply("Отправьте новую геопозицию или напишите название места до 120 символов.", { reply_markup: editLocationKeyboard() });
        return;
      }
      if (!await repository.updateSessionWaterbody(draft.sessionId, text)) { await finish("Улов уже удалён или не найден."); return; }
      await finish("✅ Название места изменено.");
      return;
    }
    case "session_waterbody": {
      if (draft.data.latitude == null || draft.data.longitude == null) { await finish("Не удалось найти новую геопозицию. Попробуйте ещё раз."); return; }
      const session = await repository.getSession(draft.sessionId);
      if (!session) { await finish("Улов уже удалён или не найден."); return; }
      const waterbody = text === labels.skip ? session.waterbody : text;
      if (waterbody != null && (!waterbody || waterbody.length > 120)) {
        await ctx.reply("Название места должно быть короче 120 символов.", { reply_markup: skipKeyboard() });
        return;
      }
      await repository.updateSessionLocation(draft.sessionId, draft.data.latitude, draft.data.longitude, waterbody ?? null);
      await finish("✅ Геопозиция улова изменена.");
      return;
    }
    case "fish_species": {
      const species = text ? normalizeSpeciesName(text) : null;
      if (!species) {
        await ctx.reply("Введите только название рыбы буквами, например <b>щука</b> или <b>белый амур</b>. Вес вводится отдельно.", { parse_mode: "HTML" });
        return;
      }
      if (!draft.fishId || !await repository.updateFishSpecies(draft.fishId, species)) { await finish("Рыба уже удалена или не найдена."); return; }
      await finish(`✅ Вид изменён: ${escapeHtml(species)}.`);
      return;
    }
    case "fish_weight": {
      const weight = text ? parseWeightGrams(text) : null;
      if (!weight) { await ctx.reply("Не распознал вес. Например: <b>4,85 кг</b> или <b>850 г</b>.", { parse_mode: "HTML" }); return; }
      if (!draft.fishId || !await repository.updateFishWeight(draft.fishId, weight)) { await finish("Рыба уже удалена или не найдена."); return; }
      await finish(`✅ Вес изменён: ${formatWeight(weight)}.`);
      return;
    }
    case "fish_length": {
      const length = text === labels.skip ? null : text ? parseLengthMm(text) : null;
      if (text !== labels.skip && !length) { await ctx.reply("Не распознал длину. Например: <b>72 см</b>. Кнопка «Пропустить» удалит длину.", { parse_mode: "HTML", reply_markup: skipKeyboard() }); return; }
      if (!draft.fishId || !await repository.updateFishLength(draft.fishId, length)) { await finish("Рыба уже удалена или не найдена."); return; }
      await finish(length == null ? "✅ Длина удалена." : `✅ Длина изменена: ${formatLength(length)}.`);
      return;
    }
    case "fish_angler": {
      const angler = await resolveAngler(repository, userId, text);
      if (!angler) { await ctx.reply("Не нашёл этого рыбака среди допущенных участников. Выберите кнопку или отправьте @username."); return; }
      if (!draft.fishId || !await repository.updateFishAngler(draft.fishId, angler.id)) { await finish("Рыба уже удалена или не найдена."); return; }
      await finish(`✅ Рыбак изменён: ${escapeHtml(angler.displayName)}.`);
      return;
    }
    case "photo_add": {
      if (ctx.message?.video) { await ctx.reply("Видео не поддерживается — пришлите фотографию.", { reply_markup: photoKeyboard() }); return; }
      if (text === labels.photosDone) {
        await repository.clearManagementDraft(userId);
        await ctx.reply("✅ Работа с фотографиями завершена.", { reply_markup: homeKeyboard });
        await showPhotoManagement(ctx, repository, draft.sessionId);
        return;
      }
      const photo = ctx.message?.photo?.at(-1);
      if (!photo) { await ctx.reply("Пришлите фото или нажмите «Фото добавлены».", { reply_markup: photoKeyboard() }); return; }
      const result = await repository.addPhoto(draft.sessionId, photo.file_id, photo.file_unique_id);
      const message = result === "added" ? "📷 Фотография добавлена. Можно прислать ещё."
        : result === "duplicate" ? "Эта фотография уже есть в улове."
          : result === "limit" ? "В улове уже 10 фотографий — это максимум."
            : "Улов уже удалён или не найден.";
      await ctx.reply(message, { reply_markup: photoKeyboard() });
      return;
    }
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
    const managementMatch = String(ctx.match).match(/^manage_([0-9a-f-]{36})$/u);
    if (managementMatch?.[1]) {
      await repository.clearDraft(user.id);
      await repository.clearManagementDraft(user.id);
      await showManagement(ctx, repository, managementMatch[1]);
      return;
    }
    await ctx.reply("🎣 <b>Наш рыболовный дневник</b>\n\nЗдесь собираются уловы, рекорды и статистика всей компании.\n\nДобавим новый улов?", { parse_mode: "HTML", reply_markup: homeKeyboard() });
  });

  bot.command("cancel", async (ctx) => {
    if (!ctx.from) return;
    await repository.clearDraft(ctx.from.id);
    await repository.clearManagementDraft(ctx.from.id);
    await ctx.reply("Текущий ввод отменён.", { reply_markup: homeKeyboard() });
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
    if (first) await sendSessionCard(ctx, session, formatSessionCard(session, recordIndexes), savedCatchKeyboard(first.id, session.id, session.latitude != null && session.longitude != null));
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

  bot.callbackQuery("m:done", async (ctx) => {
    if (ctx.from) await repository.clearManagementDraft(ctx.from.id);
    await ctx.reply("✅ Управление уловом завершено.", { reply_markup: homeKeyboard() });
  });
  bot.callbackQuery(/^m:s:([0-9a-f-]{36})$/u, async (ctx) => {
    if (ctx.from) await repository.clearManagementDraft(ctx.from.id);
    if (ctx.match[1]) await showManagement(ctx, repository, ctx.match[1]);
  });
  bot.callbackQuery(/^m:f:([0-9a-f-]{36})$/u, async (ctx) => {
    if (ctx.from) await repository.clearManagementDraft(ctx.from.id);
    if (ctx.match[1]) await showFishManagement(ctx, repository, ctx.match[1]);
  });
  bot.callbackQuery(/^m:d:([0-9a-f-]{36})$/u, async (ctx) => {
    const sessionId = ctx.match[1];
    if (!sessionId) return;
    await beginManagementEdit(ctx, repository, ctx.from.id, { step: "session_date", sessionId, fishId: null }, "📅 <b>Новая дата улова</b>\n\nВведите <b>27.10.2026</b>, <b>27 октября 2026 г.</b> или выберите кнопку.", dateKeyboard());
  });
  bot.callbackQuery(/^m:l:([0-9a-f-]{36})$/u, async (ctx) => {
    const sessionId = ctx.match[1];
    if (!sessionId) return;
    await beginManagementEdit(ctx, repository, ctx.from.id, { step: "session_location", sessionId, fishId: null }, "📍 <b>Изменение места</b>\n\nОтправьте новую геопозицию или просто напишите новое название места.", editLocationKeyboard());
  });
  bot.callbackQuery(/^m:fs:([0-9a-f-]{36})$/u, async (ctx) => {
    const fish = ctx.match[1] ? await repository.getCatch(ctx.match[1]) : null;
    if (!fish) { await ctx.reply("Рыба уже удалена или не найдена."); return; }
    await beginManagementEdit(ctx, repository, ctx.from.id, { step: "fish_species", sessionId: fish.sessionId, fishId: fish.id }, `🐟 Текущий вид: <b>${escapeHtml(fish.speciesName)}</b>.\n\nВведите новое название рыбы.`);
  });
  bot.callbackQuery(/^m:fw:([0-9a-f-]{36})$/u, async (ctx) => {
    const fish = ctx.match[1] ? await repository.getCatch(ctx.match[1]) : null;
    if (!fish) { await ctx.reply("Рыба уже удалена или не найдена."); return; }
    await beginManagementEdit(ctx, repository, ctx.from.id, { step: "fish_weight", sessionId: fish.sessionId, fishId: fish.id }, `⚖️ Текущий вес: <b>${formatWeight(fish.weightGrams)}</b>.\n\nВведите новый вес.`);
  });
  bot.callbackQuery(/^m:fl:([0-9a-f-]{36})$/u, async (ctx) => {
    const fish = ctx.match[1] ? await repository.getCatch(ctx.match[1]) : null;
    if (!fish) { await ctx.reply("Рыба уже удалена или не найдена."); return; }
    await beginManagementEdit(ctx, repository, ctx.from.id, { step: "fish_length", sessionId: fish.sessionId, fishId: fish.id }, `📏 Текущая длина: <b>${fish.lengthMm == null ? "не указана" : formatLength(fish.lengthMm)}</b>.\n\nВведите новую длину или нажмите «Пропустить», чтобы удалить её.`, skipKeyboard());
  });
  bot.callbackQuery(/^m:fa:([0-9a-f-]{36})$/u, async (ctx) => {
    const fish = ctx.match[1] ? await repository.getCatch(ctx.match[1]) : null;
    if (!fish) { await ctx.reply("Рыба уже удалена или не найдена."); return; }
    const anglers = await repository.listApprovedUsers();
    await beginManagementEdit(ctx, repository, ctx.from.id, { step: "fish_angler", sessionId: fish.sessionId, fishId: fish.id }, `👤 Сейчас указан: <b>${escapeHtml(fish.ownerName)}</b>.\n\nВыберите рыбака или отправьте @username.`, anglerKeyboard(anglers, ctx.from.id, false));
  });
  bot.callbackQuery(/^m:sd:([0-9a-f-]{36})$/u, async (ctx) => {
    const session = ctx.match[1] ? await repository.getSession(ctx.match[1]) : null;
    if (!session) { await ctx.reply("Улов уже удалён или не найден."); return; }
    await ctx.reply(`⚠️ <b>Удалить весь улов?</b>\n\nБудут удалены ${session.fishes.length} рыб и ${session.photos.length} фото. Это действие нельзя отменить.`, { parse_mode: "HTML", reply_markup: sessionDeleteConfirmationKeyboard(session.id) });
  });
  bot.callbackQuery(/^m:sdx:([0-9a-f-]{36})$/u, async (ctx) => {
    const sessionId = ctx.match[1];
    if (!sessionId) return;
    if (ctx.from) await repository.clearManagementDraft(ctx.from.id);
    const deleted = await repository.deleteSession(sessionId);
    await ctx.reply(deleted ? "🗑 Улов, все его рыбы и фотографии удалены." : "Улов уже был удалён.", { reply_markup: homeKeyboard() });
  });
  bot.callbackQuery(/^m:fd:([0-9a-f-]{36})$/u, async (ctx) => {
    const fish = ctx.match[1] ? await repository.getCatch(ctx.match[1]) : null;
    if (!fish) { await ctx.reply("Рыба уже удалена или не найдена."); return; }
    const session = await repository.getSession(fish.sessionId);
    const warning = session?.fishes.length === 1 ? "\n\nЭто единственная рыба: вместе с ней удалятся весь улов и его фото." : "";
    await ctx.reply(`⚠️ Удалить <b>${escapeHtml(fish.speciesName)}</b> · ${formatWeight(fish.weightGrams)}?${warning}`, { parse_mode: "HTML", reply_markup: fishDeleteConfirmationKeyboard(fish.id, fish.sessionId) });
  });
  bot.callbackQuery(/^m:fdx:([0-9a-f-]{36})$/u, async (ctx) => {
    const result = ctx.match[1] ? await repository.deleteFish(ctx.match[1]) : { deleted: false, sessionId: null, sessionDeleted: false };
    if (ctx.from) await repository.clearManagementDraft(ctx.from.id);
    if (!result.deleted || !result.sessionId) { await ctx.reply("Рыба уже была удалена.", { reply_markup: homeKeyboard() }); return; }
    if (result.sessionDeleted) { await ctx.reply("🗑 Рыба и оставшийся пустым улов удалены.", { reply_markup: homeKeyboard() }); return; }
    await ctx.reply("🗑 Рыба удалена из группового улова.", { reply_markup: homeKeyboard() });
    await showManagement(ctx, repository, result.sessionId);
  });
  bot.callbackQuery(/^m:p:([0-9a-f-]{36})$/u, async (ctx) => {
    if (ctx.from) await repository.clearManagementDraft(ctx.from.id);
    if (ctx.match[1]) await showPhotoManagement(ctx, repository, ctx.match[1]);
  });
  bot.callbackQuery(/^m:pa:([0-9a-f-]{36})$/u, async (ctx) => {
    const sessionId = ctx.match[1];
    if (!sessionId) return;
    await beginManagementEdit(ctx, repository, ctx.from.id, { step: "photo_add", sessionId, fishId: null }, "📷 Пришлите до 10 фотографий альбомом или по одной. Дубли не сохраняются.", photoKeyboard());
  });
  bot.callbackQuery(/^m:pc:([0-9a-f-]{36})$/u, async (ctx) => {
    const sessionId = ctx.match[1] ? await repository.setCoverPhoto(ctx.match[1]) : null;
    if (!sessionId) { await ctx.reply("Фотография уже удалена или не найдена."); return; }
    await ctx.reply("⭐ Обложка изменена.");
    await showPhotoManagement(ctx, repository, sessionId);
  });
  bot.callbackQuery(/^m:pd:([0-9a-f-]{36})$/u, async (ctx) => {
    const photo = ctx.match[1] ? await repository.getPhoto(ctx.match[1]) : null;
    if (!photo) { await ctx.reply("Фотография уже удалена или не найдена."); return; }
    await ctx.reply("⚠️ <b>Удалить эту фотографию?</b>\n\nДействие нельзя отменить.", { parse_mode: "HTML", reply_markup: photoDeleteConfirmationKeyboard(photo.id, photo.sessionId) });
  });
  bot.callbackQuery(/^m:pdx:([0-9a-f-]{36})$/u, async (ctx) => {
    const result = ctx.match[1] ? await repository.deletePhoto(ctx.match[1]) : { deleted: false, sessionId: null };
    if (!result.sessionId) { await ctx.reply("Фотография уже была удалена."); return; }
    if (result.reason === "last") { await ctx.reply("Нельзя удалить единственную фотографию: у улова должна остаться хотя бы одна."); await showPhotoManagement(ctx, repository, result.sessionId); return; }
    await ctx.reply("🗑 Фотография удалена.");
    await showPhotoManagement(ctx, repository, result.sessionId);
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
    if (text === labels.cancel) {
      await repository.clearDraft(user.id);
      await repository.clearManagementDraft(user.id);
      await ctx.reply("Текущий ввод отменён.", { reply_markup: homeKeyboard() });
      return;
    }

    if (text === labels.add) {
      await repository.clearManagementDraft(user.id);
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
        await sendSessionCard(ctx, session, formatSessionCard(session, recordFlags), first ? savedCatchKeyboard(first.id, session.id, session.latitude != null && session.longitude != null) : undefined);
      }
      return;
    }
    if (text === labels.records) { await ctx.reply(formatRecords(await repository.listRecords(), timeZone), { parse_mode: "HTML", reply_markup: homeKeyboard() }); return; }
    if (text === labels.stats) {
      await ctx.reply(formatCatchLeaderboard(await repository.listTopCatches({ metric: "weight" }), "weight", "Все рыбы"), { parse_mode: "HTML", reply_markup: catchLeaderboardKeyboard("all", "weight") });
      return;
    }

    const managementDraft = await repository.getManagementDraft(user.id);
    if (managementDraft) {
      await handleManagementInput(ctx, repository, user.id, managementDraft, timeZone, homeKeyboard());
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
        : draft.step === "species"
          ? "Введите только название рыбы буквами, например «щука» или «белый амур». Вес вводится на следующем шаге."
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
