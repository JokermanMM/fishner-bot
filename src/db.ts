import { randomUUID } from "node:crypto";
import pg from "pg";
import type {
  CatchDraft,
  CatchRecord,
  DraftRecord,
  DraftStep,
  LeaderboardRow,
  RecordRow,
} from "./types.js";

interface QueryResultLike {
  rows: Record<string, unknown>[];
  rowCount?: number | null;
}

interface DatabaseClient {
  query(text: string, values?: unknown[]): Promise<QueryResultLike>;
  release(): void;
}

export interface DatabasePool {
  query(text: string, values?: unknown[]): Promise<QueryResultLike>;
  connect(): Promise<DatabaseClient>;
  end(): Promise<void>;
}

interface CatchDbRow extends Record<string, unknown> {
  id: string;
  user_id: string | number;
  owner_name: string;
  species_name: string;
  weight_grams: string | number;
  length_mm: string | number | null;
  latitude: string | number | null;
  longitude: string | number | null;
  waterbody: string | null;
  caught_at: Date | string;
  lure: string | null;
  disposition: CatchRecord["disposition"];
  notes: string | null;
  media_type: CatchRecord["mediaType"];
  telegram_file_id: string | null;
  telegram_file_unique_id: string | null;
  created_at: Date | string;
}

function asNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapCatch(row: CatchDbRow): CatchRecord {
  return {
    id: row.id,
    userId: asNumber(row.user_id),
    ownerName: row.owner_name,
    speciesName: row.species_name,
    weightGrams: asNumber(row.weight_grams),
    lengthMm: row.length_mm == null ? null : asNumber(row.length_mm),
    latitude: row.latitude == null ? null : asNumber(row.latitude),
    longitude: row.longitude == null ? null : asNumber(row.longitude),
    waterbody: row.waterbody,
    caughtAt: asIso(row.caught_at),
    lure: row.lure,
    disposition: row.disposition,
    notes: row.notes,
    mediaType: row.media_type,
    telegramFileId: row.telegram_file_id,
    telegramFileUniqueId: row.telegram_file_unique_id,
    createdAt: asIso(row.created_at),
  };
}

export function createPostgresPool(databaseUrl: string): DatabasePool {
  const remote = !/localhost|127\.0\.0\.1/u.test(databaseUrl);
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
    ...(remote ? { ssl: { rejectUnauthorized: false } } : {}),
  }) as unknown as DatabasePool;
}

export class FishingRepository {
  constructor(private readonly db: DatabasePool) {}

  async migrate(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS users (
        telegram_user_id BIGINT PRIMARY KEY,
        username TEXT,
        first_name TEXT NOT NULL,
        is_approved BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS species (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(telegram_user_id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        UNIQUE(user_id, normalized_name)
      );

      CREATE TABLE IF NOT EXISTS catches (
        id UUID PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(telegram_user_id) ON DELETE CASCADE,
        species_id BIGINT NOT NULL REFERENCES species(id),
        weight_grams INTEGER NOT NULL CHECK(weight_grams > 0),
        length_mm INTEGER CHECK(length_mm > 0),
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        waterbody TEXT,
        caught_at TIMESTAMPTZ NOT NULL,
        lure TEXT,
        disposition TEXT NOT NULL CHECK(disposition IN ('released', 'kept', 'unknown')),
        notes TEXT,
        media_type TEXT CHECK(media_type IS NULL OR media_type IN ('photo', 'video')),
        telegram_file_id TEXT,
        telegram_file_unique_id TEXT,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS drafts (
        user_id BIGINT PRIMARY KEY REFERENCES users(telegram_user_id) ON DELETE CASCADE,
        step TEXT NOT NULL,
        data_json JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE INDEX IF NOT EXISTS catches_user_date_idx ON catches(user_id, caught_at DESC);
      CREATE INDEX IF NOT EXISTS catches_species_weight_idx ON catches(species_id, weight_grams DESC);
      CREATE INDEX IF NOT EXISTS catches_date_idx ON catches(caught_at DESC);
    `);
  }

  async close(): Promise<void> {
    await this.db.end();
  }

  async upsertUser(userId: number, firstName: string, username?: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.query(`
      INSERT INTO users (telegram_user_id, username, first_name, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $4)
      ON CONFLICT(telegram_user_id) DO UPDATE SET
        username = EXCLUDED.username,
        first_name = EXCLUDED.first_name,
        updated_at = EXCLUDED.updated_at
    `, [userId, username ?? null, firstName, now]);
  }

  async approveUser(userId: number): Promise<void> {
    await this.db.query("UPDATE users SET is_approved = TRUE, updated_at = $2 WHERE telegram_user_id = $1", [
      userId,
      new Date().toISOString(),
    ]);
  }

  async isApproved(userId: number): Promise<boolean> {
    const result = await this.db.query("SELECT is_approved FROM users WHERE telegram_user_id = $1", [userId]);
    return result.rows[0]?.is_approved === true;
  }

  async setDraft(userId: number, step: DraftStep, data: CatchDraft): Promise<void> {
    await this.db.query(`
      INSERT INTO drafts (user_id, step, data_json, updated_at)
      VALUES ($1, $2, $3::jsonb, $4)
      ON CONFLICT(user_id) DO UPDATE SET
        step = EXCLUDED.step,
        data_json = EXCLUDED.data_json,
        updated_at = EXCLUDED.updated_at
    `, [userId, step, JSON.stringify(data), new Date().toISOString()]);
  }

  async getDraft(userId: number): Promise<DraftRecord | null> {
    const result = await this.db.query("SELECT user_id, step, data_json FROM drafts WHERE user_id = $1", [userId]);
    const row = result.rows[0] as { user_id: string | number; step: DraftStep; data_json: CatchDraft } | undefined;
    return row ? { userId: asNumber(row.user_id), step: row.step, data: row.data_json } : null;
  }

  async clearDraft(userId: number): Promise<void> {
    await this.db.query("DELETE FROM drafts WHERE user_id = $1", [userId]);
  }

  async listSpecies(userId: number, limit = 8): Promise<string[]> {
    const result = await this.db.query(`
      SELECT s.name, MAX(c.caught_at) AS last_caught_at
      FROM species s
      LEFT JOIN catches c ON c.species_id = s.id
      WHERE s.user_id = $1
      GROUP BY s.id, s.name
      ORDER BY last_caught_at DESC NULLS LAST, s.name
      LIMIT $2
    `, [userId, limit]);
    return result.rows.map((row) => String(row.name));
  }

  async getBestWeight(speciesName: string): Promise<number | null> {
    const result = await this.db.query(`
      SELECT MAX(c.weight_grams) AS weight
      FROM catches c
      JOIN species s ON s.id = c.species_id
      WHERE s.normalized_name = $1
    `, [speciesName.toLocaleLowerCase("ru-RU")]);
    const value = result.rows[0]?.weight;
    return value == null ? null : asNumber(value as string | number);
  }

  async createCatch(userId: number, draft: CatchDraft): Promise<{ record: CatchRecord; isNewRecord: boolean }> {
    if (!draft.speciesName || !draft.weightGrams || !draft.caughtAt || !draft.disposition) {
      throw new Error("Черновик не содержит обязательных полей");
    }

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const normalizedName = draft.speciesName.toLocaleLowerCase("ru-RU");
      const now = new Date().toISOString();
      await client.query(`
        INSERT INTO species (user_id, name, normalized_name, created_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT(user_id, normalized_name) DO UPDATE SET name = EXCLUDED.name
      `, [userId, draft.speciesName, normalizedName, now]);

      const speciesResult = await client.query(
        "SELECT id FROM species WHERE user_id = $1 AND normalized_name = $2",
        [userId, normalizedName],
      );
      const speciesId = speciesResult.rows[0]?.id;
      if (speciesId == null) throw new Error("Не удалось создать вид рыбы");

      const previousResult = await client.query(`
        SELECT MAX(c.weight_grams) AS weight
        FROM catches c
        JOIN species s ON s.id = c.species_id
        WHERE s.normalized_name = $1
      `, [normalizedName]);
      const previousValue = previousResult.rows[0]?.weight;
      const previousWeight = previousValue == null ? null : asNumber(previousValue as string | number);

      const id = randomUUID();
      await client.query(`
        INSERT INTO catches (
          id, user_id, species_id, weight_grams, length_mm, latitude, longitude,
          waterbody, caught_at, lure, disposition, notes, media_type,
          telegram_file_id, telegram_file_unique_id, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      `, [
        id, userId, speciesId, draft.weightGrams, draft.lengthMm ?? null,
        draft.latitude ?? null, draft.longitude ?? null, draft.waterbody ?? null,
        draft.caughtAt, draft.lure ?? null, draft.disposition, draft.notes ?? null,
        draft.mediaType ?? null, draft.telegramFileId ?? null,
        draft.telegramFileUniqueId ?? null, now,
      ]);
      await client.query("DELETE FROM drafts WHERE user_id = $1", [userId]);

      const savedResult = await client.query(`
        SELECT c.*, s.name AS species_name, u.first_name AS owner_name
        FROM catches c
        JOIN species s ON s.id = c.species_id
        JOIN users u ON u.telegram_user_id = c.user_id
        WHERE c.id = $1
      `, [id]);
      const savedRow = savedResult.rows[0] as CatchDbRow | undefined;
      if (!savedRow) throw new Error("Не удалось прочитать сохранённый улов");

      await client.query("COMMIT");
      return {
        record: mapCatch(savedRow),
        isNewRecord: previousWeight == null || draft.weightGrams > previousWeight,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getCatch(id: string): Promise<CatchRecord | null> {
    const result = await this.db.query(`
      SELECT c.*, s.name AS species_name, u.first_name AS owner_name
      FROM catches c
      JOIN species s ON s.id = c.species_id
      JOIN users u ON u.telegram_user_id = c.user_id
      WHERE c.id = $1
    `, [id]);
    const row = result.rows[0] as CatchDbRow | undefined;
    return row ? mapCatch(row) : null;
  }

  async listRecentCatches(limit = 10): Promise<CatchRecord[]> {
    const result = await this.db.query(`
      SELECT c.*, s.name AS species_name, u.first_name AS owner_name
      FROM catches c
      JOIN species s ON s.id = c.species_id
      JOIN users u ON u.telegram_user_id = c.user_id
      ORDER BY c.caught_at DESC, c.created_at DESC
      LIMIT $1
    `, [limit]);
    return (result.rows as CatchDbRow[]).map(mapCatch);
  }

  async listRecords(): Promise<RecordRow[]> {
    const result = await this.db.query(`
      SELECT c.user_id, s.name AS species_name, s.normalized_name, u.first_name AS owner_name,
             c.weight_grams, c.caught_at, c.created_at
      FROM catches c
      JOIN species s ON s.id = c.species_id
      JOIN users u ON u.telegram_user_id = c.user_id
      ORDER BY c.weight_grams DESC, c.caught_at ASC, c.created_at ASC
    `);
    const bestWeights = new Map<string, number>();
    for (const row of result.rows) {
      const normalizedName = String(row.normalized_name);
      if (!bestWeights.has(normalizedName)) {
        bestWeights.set(normalizedName, asNumber(row.weight_grams as string | number));
      }
    }

    const seenHolders = new Set<string>();
    const records: RecordRow[] = [];
    for (const row of result.rows) {
      const normalizedName = String(row.normalized_name);
      const weightGrams = asNumber(row.weight_grams as string | number);
      const holderKey = `${normalizedName}\u0000${String(row.user_id)}`;
      if (weightGrams !== bestWeights.get(normalizedName) || seenHolders.has(holderKey)) continue;
      seenHolders.add(holderKey);
      records.push({
        speciesName: String(row.species_name),
        ownerName: String(row.owner_name),
        weightGrams,
        caughtAt: asIso(row.caught_at as Date | string),
      });
    }
    return records;
  }

  async listLeaderboard(): Promise<LeaderboardRow[]> {
    const [usersResult, catchesResult] = await Promise.all([
      this.db.query(`
        SELECT telegram_user_id AS user_id, first_name AS owner_name
        FROM users
        WHERE is_approved = TRUE
      `),
      this.db.query(`
        SELECT c.user_id, c.weight_grams, s.normalized_name, c.caught_at, c.created_at
        FROM catches c
        JOIN species s ON s.id = c.species_id
        ORDER BY c.weight_grams DESC, c.caught_at ASC, c.created_at ASC
      `),
    ]);

    const leaderboard = new Map<number, LeaderboardRow>();
    const speciesByUser = new Map<number, Set<string>>();
    for (const row of usersResult.rows) {
      const userId = asNumber(row.user_id as string | number);
      leaderboard.set(userId, {
        userId,
        ownerName: String(row.owner_name),
        catchesCount: 0,
        totalWeightGrams: 0,
        speciesCount: 0,
        recordsCount: 0,
      });
      speciesByUser.set(userId, new Set());
    }

    const bestWeights = new Map<string, number>();
    const awardedRecords = new Set<string>();
    for (const row of catchesResult.rows) {
      const userId = asNumber(row.user_id as string | number);
      const stats = leaderboard.get(userId);
      if (!stats) continue;
      const normalizedName = String(row.normalized_name);
      stats.catchesCount += 1;
      const weightGrams = asNumber(row.weight_grams as string | number);
      stats.totalWeightGrams += weightGrams;
      speciesByUser.get(userId)?.add(normalizedName);
      const bestWeight = bestWeights.get(normalizedName);
      if (bestWeight == null) bestWeights.set(normalizedName, weightGrams);
      const recordKey = `${normalizedName}\u0000${userId}`;
      if (weightGrams === (bestWeight ?? weightGrams) && !awardedRecords.has(recordKey)) {
        awardedRecords.add(recordKey);
        stats.recordsCount += 1;
      }
    }

    for (const [userId, stats] of leaderboard) {
      stats.speciesCount = speciesByUser.get(userId)?.size ?? 0;
    }

    return [...leaderboard.values()].sort((left, right) =>
      right.recordsCount - left.recordsCount
      || right.totalWeightGrams - left.totalWeightGrams
      || right.catchesCount - left.catchesCount
      || left.ownerName.localeCompare(right.ownerName, "ru"),
    );
  }

  async isRecord(record: CatchRecord): Promise<boolean> {
    const best = await this.getBestWeight(record.speciesName);
    return best === record.weightGrams;
  }
}
