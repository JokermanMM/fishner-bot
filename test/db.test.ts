import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import { FishingRepository, type DatabasePool } from "../src/db.js";

async function createRepository(): Promise<FishingRepository> {
  const memoryDb = newDb({ autoCreateForeignKeyIndices: true });
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
    caughtAt: "2026-10-07T04:42:00.000Z",
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
