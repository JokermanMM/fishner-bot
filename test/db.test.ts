import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import { FishingRepository, type DatabasePool } from "../src/db.js";

async function createRepository(): Promise<FishingRepository> {
  const memoryDb = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
  const adapter = memoryDb.adapters.createPg();
  const pool = new adapter.Pool() as unknown as DatabasePool;
  const repository = new FishingRepository(pool);
  await repository.migrate();
  return repository;
}

test("общая база хранит автора, рекорды и статистику", async () => {
  const repository = await createRepository();
  await repository.upsertUser(1, "Михаил");
  await repository.upsertUser(2, "Андрей");
  await repository.approveUser(1);
  await repository.approveUser(2);

  const draft = {
    speciesName: "Щука",
    weightGrams: 4850,
    caughtOn: "2026-10-07",
    disposition: "released" as const,
  };
  const first = await repository.createCatch(1, draft);
  assert.equal(first.isNewRecord, true);
  assert.equal(first.record.ownerName, "Михаил");

  const second = await repository.createCatch(2, { ...draft, weightGrams: 3000 });
  assert.equal(second.isNewRecord, false);

  const tied = await repository.createCatch(2, draft);
  assert.equal(tied.isNewRecord, false);
  assert.equal(await repository.isRecord(tied.record), true);

  const feed = await repository.listRecentCatches();
  assert.equal(feed.length, 3);
  assert.deepEqual(new Set(feed.map((item) => item.ownerName)), new Set(["Михаил", "Андрей"]));

  const records = await repository.listRecords();
  assert.equal(records[0]?.weightGrams, 4850);
  assert.equal(records[0]?.ownerName, "Михаил");
  assert.equal(records[1]?.ownerName, "Андрей");

  const leaderboard = await repository.listLeaderboard();
  assert.equal(leaderboard[0]?.ownerName, "Андрей");
  assert.equal(leaderboard[0]?.recordsCount, 1);
  assert.equal(leaderboard[1]?.recordsCount, 1);
  await repository.close();
});

test("вход в закрытый бот требует одобрения", async () => {
  const repository = await createRepository();
  await repository.upsertUser(10, "Гость");
  assert.equal(await repository.isApproved(10), false);
  await repository.approveUser(10);
  assert.equal(await repository.isApproved(10), true);
  await repository.close();
});

test("одна сессия сохраняет несколько рыб с общими данными", async () => {
  const repository = await createRepository();
  await repository.upsertUser(1, "Михаил");
  await repository.approveUser(1);

  const saved = await repository.createCatchBatch(1, {
    caughtOn: "2026-10-07",
    disposition: "released",
    waterbody: "Лесное озеро",
    latitude: 55.75,
    longitude: 37.61,
    photos: [
      { telegramFileId: "photo-file-id", telegramFileUniqueId: "photo-unique-id" },
      { telegramFileId: "photo-file-id-2", telegramFileUniqueId: "photo-unique-id-2" },
    ],
    fishes: [
      { anglerUserId: 1, anglerName: "Михаил", speciesName: "Щука", weightGrams: 3000, lengthMm: 700 },
      { anglerUserId: 1, anglerName: "Михаил", speciesName: "Щука", weightGrams: 5000, lengthMm: 850 },
      { anglerUserId: 1, anglerName: "Михаил", speciesName: "Окунь", weightGrams: 900 },
    ],
  });

  assert.equal(saved.length, 3);
  assert.deepEqual(saved.map((item) => item.isNewRecord), [false, true, true]);
  assert.ok(saved.every((item) => item.record.waterbody === "Лесное озеро"));
  assert.ok(saved.every((item) => item.record.photos.length === 2));
  assert.equal((await repository.listRecentSessions())[0]?.fishes.length, 3);

  assert.deepEqual(await repository.getLastNamedLocation(1), {
    latitude: 55.75,
    longitude: 37.61,
    waterbody: "Лесное озеро",
  });

  const leaderboard = await repository.listLeaderboard();
  assert.equal(leaderboard[0]?.catchesCount, 3);
  assert.equal(leaderboard[0]?.totalWeightGrams, 8900);
  assert.equal(leaderboard[0]?.speciesCount, 2);
  assert.equal(leaderboard[0]?.recordsCount, 2);
  await repository.close();
});

test("последнее место принадлежит конкретному рыбаку и требует названия", async () => {
  const repository = await createRepository();
  await repository.upsertUser(1, "Михаил");
  await repository.upsertUser(2, "Андрей");
  await repository.approveUser(1);
  await repository.approveUser(2);
  const base = { speciesName: "Щука", weightGrams: 1000, caughtOn: "2026-10-07", disposition: "released" as const };
  await repository.createCatch(1, { ...base, latitude: 55.1, longitude: 37.1 });
  await repository.createCatch(2, { ...base, waterbody: "Чужое озеро", latitude: 56.2, longitude: 38.2 });
  assert.equal(await repository.getLastNamedLocation(1), null);
  assert.deepEqual(await repository.getLastNamedLocation(2), {
    latitude: 56.2,
    longitude: 38.2,
    waterbody: "Чужое озеро",
  });
  await repository.close();
});

test("топ уловов фильтруется по виду, рыбаку, весу и длине", async () => {
  const repository = await createRepository();
  await repository.upsertUser(1, "Михаил");
  await repository.upsertUser(2, "Андрей");
  await repository.approveUser(1);
  await repository.approveUser(2);
  const base = { caughtOn: "2026-10-07", disposition: "kept" as const };
  await repository.createCatch(1, { ...base, speciesName: "Щука", weightGrams: 4000, lengthMm: 800 });
  await repository.createCatch(2, { ...base, speciesName: "Щука", weightGrams: 5000, lengthMm: 750 });
  await repository.createCatch(1, { ...base, speciesName: "Окунь", weightGrams: 1000, lengthMm: 400 });

  const species = await repository.listSpeciesFilters();
  const pike = species.find((item) => item.name === "Щука");
  assert.ok(pike);
  assert.deepEqual(
    (await repository.listTopCatches({ metric: "weight", speciesId: pike.id })).map((item) => item.weightGrams),
    [5000, 4000],
  );
  assert.deepEqual(
    (await repository.listTopCatches({ metric: "length", userId: 1 })).map((item) => item.lengthMm),
    [800, 400],
  );
  await repository.close();
});

test("автор записи и настоящий рыбак хранятся отдельно, а фото не дублируются", async () => {
  const repository = await createRepository();
  await repository.upsertUser(1, "Антон", "Петров", "anton");
  await repository.upsertUser(2, "Максим", "Шнер", "jokerman");
  await repository.approveUser(1);
  await repository.approveUser(2);

  const angler = await repository.findApprovedUserByUsername("@jokerman");
  assert.deepEqual(angler, { id: 2, displayName: "Максим Шнер", username: "jokerman" });

  const saved = await repository.createCatchBatch(1, {
    caughtOn: "2026-10-12",
    disposition: "released",
    photos: [
      { telegramFileId: "photo-a", telegramFileUniqueId: "same-photo" },
      { telegramFileId: "photo-a-duplicate", telegramFileUniqueId: "same-photo" },
      { telegramFileId: "photo-b", telegramFileUniqueId: "second-photo" },
    ],
    fishes: [
      { anglerUserId: 2, anglerName: "Максим Шнер", speciesName: "Щука", weightGrams: 5200 },
      { anglerUserId: 1, anglerName: "Антон Петров", speciesName: "Окунь", weightGrams: 800 },
    ],
  });

  assert.equal(saved[0]?.record.ownerName, "Максим Шнер");
  assert.equal(saved[0]?.record.createdByName, "Антон Петров");
  assert.equal(saved[0]?.record.photos.length, 2);
  const sessions = await repository.listRecentSessions();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.photos.length, 2);
  assert.equal(sessions[0]?.fishes.length, 2);
  await repository.close();
});

test("миграция объединяет старый пакет рыб в один улов с одной фотографией", async () => {
  const memoryDb = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
  const adapter = memoryDb.adapters.createPg();
  const pool = new adapter.Pool() as unknown as DatabasePool;
  await pool.query(`
    CREATE TABLE users (
      telegram_user_id BIGINT PRIMARY KEY, username TEXT, first_name TEXT NOT NULL,
      is_approved BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE species (
      id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(telegram_user_id),
      name TEXT NOT NULL, normalized_name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL,
      UNIQUE(user_id, normalized_name)
    );
    CREATE TABLE catches (
      id UUID PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(telegram_user_id),
      species_id BIGINT NOT NULL REFERENCES species(id), weight_grams INTEGER NOT NULL, length_mm INTEGER,
      latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, waterbody TEXT, caught_at TIMESTAMPTZ NOT NULL,
      lure TEXT, disposition TEXT NOT NULL, notes TEXT, media_type TEXT,
      telegram_file_id TEXT, telegram_file_unique_id TEXT, created_at TIMESTAMPTZ NOT NULL
    );
    INSERT INTO users VALUES (1, 'mike', 'Михаил', TRUE, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z');
    INSERT INTO species (user_id, name, normalized_name, created_at)
      VALUES (1, 'Щука', 'щука', '2026-10-01T00:00:00Z');
    INSERT INTO catches VALUES
      ('00000000-0000-0000-0000-000000000001', 1, 1, 3000, 700, 55.7, 37.6, 'Озеро', '2026-10-06T22:30:00Z', NULL, 'released', NULL, 'photo', 'file', 'unique', '2026-10-07T10:00:00Z'),
      ('00000000-0000-0000-0000-000000000002', 1, 1, 5000, 850, 55.7, 37.6, 'Озеро', '2026-10-06T22:30:00Z', NULL, 'released', NULL, 'photo', 'file', 'unique', '2026-10-07T10:00:00Z');
  `);

  const repository = new FishingRepository(pool);
  await repository.migrate();
  const sessions = await repository.listRecentSessions();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.fishes.length, 2);
  assert.equal(sessions[0]?.photos.length, 1);
  assert.equal(sessions[0]?.caughtOn, "2026-10-07");
  await repository.close();
});
