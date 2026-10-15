import { randomUUID } from "node:crypto";
import pg from "pg";
import type {
  AnglerOption,
  CatchDraft,
  CatchItemDraft,
  CatchLeaderboardFilter,
  CatchPhoto,
  CatchRecord,
  CatchSessionRecord,
  DraftRecord,
  DraftStep,
  LeaderboardFilterOption,
  LeaderboardRow,
  ManagementDraft,
  ManagementDraftData,
  ManagementStep,
  PreviousLocation,
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
  session_id: string;
  user_id: string | number;
  owner_name: string;
  created_by_user_id: string | number;
  created_by_name: string;
  species_name: string;
  weight_grams: string | number;
  length_mm: string | number | null;
  latitude: string | number | null;
  longitude: string | number | null;
  waterbody: string | null;
  caught_on: Date | string;
  lure: string | null;
  disposition: CatchRecord["disposition"];
  notes: string | null;
  created_at: Date | string;
}

interface SessionDbRow extends Record<string, unknown> {
  id: string;
  created_by_user_id: string | number;
  created_by_name: string;
  latitude: string | number | null;
  longitude: string | number | null;
  waterbody: string | null;
  caught_on: Date | string;
  lure: string | null;
  disposition: CatchRecord["disposition"];
  notes: string | null;
  created_at: Date | string;
}

const displayNameSql = (alias: string): string =>
  `${alias}.first_name || CASE WHEN ${alias}.last_name IS NULL OR ${alias}.last_name = '' THEN '' ELSE ' ' || ${alias}.last_name END`;

function asNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function asDateOnly(value: Date | string): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value instanceof Date ? value : new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function mapCatch(row: CatchDbRow, photos: CatchPhoto[] = []): CatchRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: asNumber(row.user_id),
    ownerName: row.owner_name,
    createdByUserId: asNumber(row.created_by_user_id),
    createdByName: row.created_by_name,
    speciesName: row.species_name,
    weightGrams: asNumber(row.weight_grams),
    lengthMm: row.length_mm == null ? null : asNumber(row.length_mm),
    latitude: row.latitude == null ? null : asNumber(row.latitude),
    longitude: row.longitude == null ? null : asNumber(row.longitude),
    waterbody: row.waterbody,
    caughtOn: asDateOnly(row.caught_on),
    lure: row.lure,
    disposition: row.disposition,
    notes: row.notes,
    photos,
    createdAt: asIso(row.created_at),
  };
}

function mapPhoto(row: Record<string, unknown>): CatchPhoto {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    telegramFileId: String(row.telegram_file_id),
    telegramFileUniqueId: String(row.telegram_file_unique_id),
    position: asNumber(row.position as string | number),
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
        last_name TEXT,
        is_approved BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT;

      CREATE TABLE IF NOT EXISTS species (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(telegram_user_id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        UNIQUE(user_id, normalized_name)
      );

      CREATE TABLE IF NOT EXISTS catch_sessions (
        id UUID PRIMARY KEY,
        created_by_user_id BIGINT NOT NULL REFERENCES users(telegram_user_id),
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        waterbody TEXT,
        caught_on DATE NOT NULL,
        lure TEXT,
        disposition TEXT NOT NULL CHECK(disposition IN ('released', 'kept', 'unknown')),
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS catches (
        id UUID PRIMARY KEY,
        session_id UUID REFERENCES catch_sessions(id) ON DELETE CASCADE,
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
      ALTER TABLE catches ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES catch_sessions(id) ON DELETE CASCADE;

      CREATE TABLE IF NOT EXISTS catch_photos (
        id UUID PRIMARY KEY,
        session_id UUID NOT NULL REFERENCES catch_sessions(id) ON DELETE CASCADE,
        telegram_file_id TEXT NOT NULL,
        telegram_file_unique_id TEXT NOT NULL,
        position INTEGER NOT NULL CHECK(position >= 0),
        UNIQUE(session_id, telegram_file_unique_id),
        UNIQUE(session_id, position)
      );

      CREATE TABLE IF NOT EXISTS drafts (
        user_id BIGINT PRIMARY KEY REFERENCES users(telegram_user_id) ON DELETE CASCADE,
        step TEXT NOT NULL,
        data_json JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS management_drafts (
        user_id BIGINT PRIMARY KEY REFERENCES users(telegram_user_id) ON DELETE CASCADE,
        step TEXT NOT NULL,
        session_id UUID NOT NULL REFERENCES catch_sessions(id) ON DELETE CASCADE,
        fish_id UUID REFERENCES catches(id) ON DELETE CASCADE,
        data_json JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE INDEX IF NOT EXISTS catches_user_date_idx ON catches(user_id, caught_at DESC);
      CREATE INDEX IF NOT EXISTS catches_species_weight_idx ON catches(species_id, weight_grams DESC);
      CREATE INDEX IF NOT EXISTS catches_date_idx ON catches(caught_at DESC);
      CREATE INDEX IF NOT EXISTS catches_session_idx ON catches(session_id);
      CREATE INDEX IF NOT EXISTS catch_sessions_date_idx ON catch_sessions(caught_on DESC, created_at DESC);
      CREATE INDEX IF NOT EXISTS catch_photos_session_idx ON catch_photos(session_id, position);
    `);
    await this.migrateLegacyCatches();
  }

  private async migrateLegacyCatches(): Promise<void> {
    const result = await this.db.query(`
      SELECT id, user_id, latitude, longitude, waterbody, caught_at, lure, disposition, notes,
             media_type, telegram_file_id, telegram_file_unique_id, created_at
      FROM catches
      WHERE session_id IS NULL
      ORDER BY created_at, id
    `);
    if (result.rows.length === 0) return;

    const groups = new Map<string, Record<string, unknown>[]>();
    for (const row of result.rows) {
      const key = JSON.stringify([
        String(row.user_id), String(row.created_at), String(row.caught_at), row.latitude, row.longitude,
        row.waterbody, row.lure, row.disposition, row.notes, row.telegram_file_unique_id,
      ]);
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      for (const rows of groups.values()) {
        const first = rows[0];
        if (!first) continue;
        const sessionId = randomUUID();
        await client.query(`
          INSERT INTO catch_sessions (
            id, created_by_user_id, latitude, longitude, waterbody, caught_on,
            lure, disposition, notes, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
          sessionId, first.user_id, first.latitude, first.longitude, first.waterbody,
          asDateOnly(first.caught_at as Date | string), first.lure, first.disposition, first.notes, first.created_at,
        ]);
        if (first.media_type === "photo" && first.telegram_file_id && first.telegram_file_unique_id) {
          await client.query(`
            INSERT INTO catch_photos (id, session_id, telegram_file_id, telegram_file_unique_id, position)
            VALUES ($1, $2, $3, $4, 0)
          `, [randomUUID(), sessionId, first.telegram_file_id, first.telegram_file_unique_id]);
        }
        for (const row of rows) await client.query("UPDATE catches SET session_id = $1 WHERE id = $2", [sessionId, row.id]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.db.end();
  }

  async upsertUser(userId: number, firstName: string, lastName?: string, username?: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.query(`
      INSERT INTO users (telegram_user_id, username, first_name, last_name, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $5)
      ON CONFLICT(telegram_user_id) DO UPDATE SET
        username = EXCLUDED.username,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        updated_at = EXCLUDED.updated_at
    `, [userId, username ?? null, firstName, lastName ?? null, now]);
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

  async listApprovedUsers(): Promise<AnglerOption[]> {
    const result = await this.db.query(`
      SELECT telegram_user_id AS id, username, first_name, last_name
      FROM users WHERE is_approved = TRUE
      ORDER BY first_name, last_name
    `);
    return result.rows.map((row) => ({
      id: asNumber(row.id as string | number),
      displayName: `${String(row.first_name)}${row.last_name ? ` ${String(row.last_name)}` : ""}`,
      username: row.username == null ? null : String(row.username),
    }));
  }

  async findApprovedUserByUsername(username: string): Promise<AnglerOption | null> {
    const normalized = username.trim().replace(/^@/u, "");
    const result = await this.db.query(`
      SELECT telegram_user_id AS id, username, first_name, last_name
      FROM users
      WHERE is_approved = TRUE AND LOWER(username) = LOWER($1)
      LIMIT 1
    `, [normalized]);
    const row = result.rows[0];
    return row ? {
      id: asNumber(row.id as string | number),
      displayName: `${String(row.first_name)}${row.last_name ? ` ${String(row.last_name)}` : ""}`,
      username: row.username == null ? null : String(row.username),
    } : null;
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
    const row = result.rows[0] as { user_id: string | number; step: DraftStep | "caught_at"; data_json: CatchDraft } | undefined;
    if (!row) return null;
    const data = { ...row.data_json };
    if (!data.caughtOn && data.caughtAt) data.caughtOn = asDateOnly(data.caughtAt);
    if (!data.photos && data.mediaType === "photo" && data.telegramFileId && data.telegramFileUniqueId) {
      data.photos = [{ telegramFileId: data.telegramFileId, telegramFileUniqueId: data.telegramFileUniqueId }];
    }
    return { userId: asNumber(row.user_id), step: row.step === "caught_at" ? "caught_on" : row.step, data };
  }

  async clearDraft(userId: number): Promise<void> {
    await this.db.query("DELETE FROM drafts WHERE user_id = $1", [userId]);
  }

  async setManagementDraft(
    userId: number,
    step: ManagementStep,
    sessionId: string,
    fishId: string | null = null,
    data: ManagementDraftData = {},
  ): Promise<void> {
    await this.db.query(`
      INSERT INTO management_drafts (user_id, step, session_id, fish_id, data_json, updated_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6)
      ON CONFLICT(user_id) DO UPDATE SET
        step = EXCLUDED.step,
        session_id = EXCLUDED.session_id,
        fish_id = EXCLUDED.fish_id,
        data_json = EXCLUDED.data_json,
        updated_at = EXCLUDED.updated_at
    `, [userId, step, sessionId, fishId, JSON.stringify(data), new Date().toISOString()]);
  }

  async getManagementDraft(userId: number): Promise<ManagementDraft | null> {
    const result = await this.db.query(`
      SELECT user_id, step, session_id, fish_id, data_json
      FROM management_drafts WHERE user_id = $1
    `, [userId]);
    const row = result.rows[0] as {
      user_id: string | number;
      step: ManagementStep;
      session_id: string;
      fish_id: string | null;
      data_json: ManagementDraftData;
    } | undefined;
    return row ? {
      userId: asNumber(row.user_id),
      step: row.step,
      sessionId: row.session_id,
      fishId: row.fish_id,
      data: row.data_json,
    } : null;
  }

  async clearManagementDraft(userId: number): Promise<void> {
    await this.db.query("DELETE FROM management_drafts WHERE user_id = $1", [userId]);
  }

  async listSpecies(_userId: number, limit = 8): Promise<string[]> {
    const result = await this.db.query(`
      SELECT s.name, MAX(cs.created_at) AS last_caught_at
      FROM species s
      JOIN catches c ON c.species_id = s.id
      JOIN catch_sessions cs ON cs.id = c.session_id
      GROUP BY s.normalized_name, s.name
      ORDER BY last_caught_at DESC NULLS LAST, s.name
      LIMIT $1
    `, [limit]);
    return result.rows.map((row) => String(row.name));
  }

  async getLastNamedLocation(userId: number): Promise<PreviousLocation | null> {
    const result = await this.db.query(`
      SELECT latitude, longitude, waterbody
      FROM catch_sessions
      WHERE created_by_user_id = $1
        AND latitude IS NOT NULL AND longitude IS NOT NULL
        AND waterbody IS NOT NULL AND waterbody <> ''
      ORDER BY created_at DESC, caught_on DESC
      LIMIT 1
    `, [userId]);
    const row = result.rows[0];
    if (row?.latitude == null || row.longitude == null || row.waterbody == null) return null;
    return {
      latitude: asNumber(row.latitude as string | number),
      longitude: asNumber(row.longitude as string | number),
      waterbody: String(row.waterbody),
    };
  }

  async getBestWeight(speciesName: string): Promise<number | null> {
    const result = await this.db.query(`
      SELECT MAX(c.weight_grams) AS weight
      FROM catches c JOIN species s ON s.id = c.species_id
      WHERE s.normalized_name = $1
    `, [speciesName.toLocaleLowerCase("ru-RU")]);
    const value = result.rows[0]?.weight;
    return value == null ? null : asNumber(value as string | number);
  }

  async createCatchBatch(
    createdByUserId: number,
    draft: CatchDraft,
  ): Promise<Array<{ record: CatchRecord; isNewRecord: boolean }>> {
    const fishes = draft.fishes ?? [];
    const photos = [...new Map((draft.photos ?? []).map((photo) => [photo.telegramFileUniqueId, photo])).values()];
    if (
      !draft.caughtOn || !draft.disposition || photos.length === 0 || photos.length > 10 || fishes.length === 0 ||
      fishes.some((fish) => !fish.anglerUserId || !fish.anglerName || !fish.speciesName || !fish.weightGrams)
    ) throw new Error("Черновик не содержит обязательных полей");

    const completeFishes = fishes as Array<Required<Pick<CatchItemDraft, "anglerUserId" | "anglerName" | "speciesName" | "weightGrams">> & CatchItemDraft>;
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const now = new Date().toISOString();
      const sessionId = randomUUID();
      const previousBest = new Map<string, number | null>();
      const maximumInBatch = new Map<string, number>();
      for (const fish of completeFishes) {
        const approved = await client.query("SELECT 1 AS ok FROM users WHERE telegram_user_id = $1 AND is_approved = TRUE", [fish.anglerUserId]);
        if (!approved.rows[0]) throw new Error("Выбранный рыбак не зарегистрирован в боте");
        const normalizedName = fish.speciesName.toLocaleLowerCase("ru-RU");
        maximumInBatch.set(normalizedName, Math.max(maximumInBatch.get(normalizedName) ?? 0, fish.weightGrams));
        if (!previousBest.has(normalizedName)) {
          const previous = await client.query(`
            SELECT MAX(c.weight_grams) AS weight FROM catches c
            JOIN species s ON s.id = c.species_id WHERE s.normalized_name = $1
          `, [normalizedName]);
          const value = previous.rows[0]?.weight;
          previousBest.set(normalizedName, value == null ? null : asNumber(value as string | number));
        }
      }

      await client.query(`
        INSERT INTO catch_sessions (
          id, created_by_user_id, latitude, longitude, waterbody, caught_on,
          lure, disposition, notes, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        sessionId, createdByUserId, draft.latitude ?? null, draft.longitude ?? null, draft.waterbody ?? null,
        draft.caughtOn, draft.lure ?? null, draft.disposition, draft.notes ?? null, now,
      ]);

      const savedPhotos: CatchPhoto[] = [];
      for (const [position, photo] of photos.entries()) {
        const id = randomUUID();
        await client.query(`
          INSERT INTO catch_photos (id, session_id, telegram_file_id, telegram_file_unique_id, position)
          VALUES ($1, $2, $3, $4, $5)
        `, [id, sessionId, photo.telegramFileId, photo.telegramFileUniqueId, position]);
        savedPhotos.push({ id, sessionId, telegramFileId: photo.telegramFileId, telegramFileUniqueId: photo.telegramFileUniqueId, position });
      }

      const saved: Array<{ record: CatchRecord; isNewRecord: boolean }> = [];
      for (const fish of completeFishes) {
        const normalizedName = fish.speciesName.toLocaleLowerCase("ru-RU");
        await client.query(`
          INSERT INTO species (user_id, name, normalized_name, created_at)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT(user_id, normalized_name) DO UPDATE SET name = EXCLUDED.name
        `, [fish.anglerUserId, fish.speciesName, normalizedName, now]);
        const speciesResult = await client.query(
          "SELECT id FROM species WHERE user_id = $1 AND normalized_name = $2",
          [fish.anglerUserId, normalizedName],
        );
        const speciesId = speciesResult.rows[0]?.id;
        if (speciesId == null) throw new Error("Не удалось создать вид рыбы");

        const id = randomUUID();
        await client.query(`
          INSERT INTO catches (
            id, session_id, user_id, species_id, weight_grams, length_mm,
            caught_at, disposition, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          id, sessionId, fish.anglerUserId, speciesId, fish.weightGrams, fish.lengthMm ?? null,
          `${draft.caughtOn}T12:00:00.000Z`, draft.disposition, now,
        ]);
        const savedResult = await client.query(`${this.catchSelectSql()} WHERE c.id = $1`, [id]);
        const row = savedResult.rows[0] as CatchDbRow | undefined;
        if (!row) throw new Error("Не удалось прочитать сохранённый улов");
        const bestBefore = previousBest.get(normalizedName) ?? null;
        saved.push({
          record: mapCatch(row, savedPhotos),
          isNewRecord: (bestBefore == null || fish.weightGrams > bestBefore)
            && fish.weightGrams === maximumInBatch.get(normalizedName),
        });
      }
      await client.query("DELETE FROM drafts WHERE user_id = $1", [createdByUserId]);
      await client.query("COMMIT");
      return saved;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createCatch(userId: number, draft: CatchDraft): Promise<{ record: CatchRecord; isNewRecord: boolean }> {
    const legacyFish: CatchItemDraft = { anglerUserId: userId, anglerName: "Рыбак" };
    if (draft.speciesName) legacyFish.speciesName = draft.speciesName;
    if (draft.weightGrams) legacyFish.weightGrams = draft.weightGrams;
    if (draft.lengthMm) legacyFish.lengthMm = draft.lengthMm;
    const fishes: CatchItemDraft[] = draft.fishes?.length ? draft.fishes : [legacyFish];
    const enriched = await this.listApprovedUsers();
    const owner = enriched.find((item) => item.id === userId);
    const caughtOn = draft.caughtOn ?? (draft.caughtAt ? asDateOnly(draft.caughtAt) : undefined);
    const normalized: CatchDraft = {
      ...draft,
      photos: draft.photos ?? (draft.telegramFileId && draft.telegramFileUniqueId
        ? [{ telegramFileId: draft.telegramFileId, telegramFileUniqueId: draft.telegramFileUniqueId }]
        : [{ telegramFileId: "test-photo", telegramFileUniqueId: randomUUID() }]),
      fishes: fishes.map((fish) => ({ ...fish, anglerUserId: fish.anglerUserId ?? userId, anglerName: fish.anglerName ?? owner?.displayName ?? "Рыбак" })),
    };
    if (caughtOn) normalized.caughtOn = caughtOn;
    const [saved] = await this.createCatchBatch(userId, normalized);
    if (!saved) throw new Error("Не удалось сохранить улов");
    return saved;
  }

  private catchSelectSql(): string {
    return `
      SELECT c.id, c.session_id, c.user_id, s.name AS species_name, c.weight_grams, c.length_mm,
             cs.created_by_user_id, cs.latitude, cs.longitude, cs.waterbody, cs.caught_on,
             cs.lure, cs.disposition, cs.notes, cs.created_at,
             ${displayNameSql("u")} AS owner_name,
             ${displayNameSql("creator")} AS created_by_name
      FROM catches c
      JOIN catch_sessions cs ON cs.id = c.session_id
      JOIN species s ON s.id = c.species_id
      JOIN users u ON u.telegram_user_id = c.user_id
      JOIN users creator ON creator.telegram_user_id = cs.created_by_user_id
    `;
  }

  private async photosForSessions(sessionIds: string[]): Promise<Map<string, CatchPhoto[]>> {
    const result = new Map<string, CatchPhoto[]>();
    if (sessionIds.length === 0) return result;
    const placeholders = sessionIds.map((_, index) => `$${index + 1}`).join(", ");
    const rows = await this.db.query(`
      SELECT id, session_id, telegram_file_id, telegram_file_unique_id, position
      FROM catch_photos WHERE session_id IN (${placeholders}) ORDER BY session_id, position
    `, sessionIds);
    for (const row of rows.rows) {
      const sessionId = String(row.session_id);
      const photos = result.get(sessionId) ?? [];
      photos.push(mapPhoto(row));
      result.set(sessionId, photos);
    }
    return result;
  }

  async getCatch(id: string): Promise<CatchRecord | null> {
    const result = await this.db.query(`${this.catchSelectSql()} WHERE c.id = $1`, [id]);
    const row = result.rows[0] as CatchDbRow | undefined;
    if (!row) return null;
    const photos = await this.photosForSessions([row.session_id]);
    return mapCatch(row, photos.get(row.session_id) ?? []);
  }

  async getPhoto(photoId: string): Promise<CatchPhoto | null> {
    const result = await this.db.query(`
      SELECT p.* FROM catch_photos p
      JOIN catch_sessions cs ON cs.id = p.session_id
      WHERE p.id = $1
    `, [photoId]);
    return result.rows[0] ? mapPhoto(result.rows[0]) : null;
  }

  async listRecentCatches(limit = 10): Promise<CatchRecord[]> {
    const result = await this.db.query(`${this.catchSelectSql()} ORDER BY cs.caught_on DESC, cs.created_at DESC, c.id LIMIT $1`, [limit]);
    const rows = result.rows as CatchDbRow[];
    const photos = await this.photosForSessions([...new Set(rows.map((row) => row.session_id))]);
    return rows.map((row) => mapCatch(row, photos.get(row.session_id) ?? []));
  }

  async listRecentSessions(limit = 250): Promise<CatchSessionRecord[]> {
    const sessionsResult = await this.db.query(`
      SELECT cs.*, ${displayNameSql("creator")} AS created_by_name
      FROM catch_sessions cs
      JOIN users creator ON creator.telegram_user_id = cs.created_by_user_id
      ORDER BY cs.caught_on DESC, cs.created_at DESC
      LIMIT $1
    `, [limit]);
    const sessionRows = sessionsResult.rows as SessionDbRow[];
    if (sessionRows.length === 0) return [];
    const ids = sessionRows.map((row) => row.id);
    const placeholders = ids.map((_, index) => `$${index + 1}`).join(", ");
    const fishResult = await this.db.query(`${this.catchSelectSql()} WHERE c.session_id IN (${placeholders}) ORDER BY c.id`, ids);
    const photos = await this.photosForSessions(ids);
    const fishes = new Map<string, CatchRecord[]>();
    for (const row of fishResult.rows as CatchDbRow[]) {
      const list = fishes.get(row.session_id) ?? [];
      list.push(mapCatch(row, photos.get(row.session_id) ?? []));
      fishes.set(row.session_id, list);
    }
    return sessionRows.map((row) => ({
      id: row.id,
      createdByUserId: asNumber(row.created_by_user_id),
      createdByName: row.created_by_name,
      latitude: row.latitude == null ? null : asNumber(row.latitude),
      longitude: row.longitude == null ? null : asNumber(row.longitude),
      waterbody: row.waterbody,
      caughtOn: asDateOnly(row.caught_on),
      lure: row.lure,
      disposition: row.disposition,
      notes: row.notes,
      photos: photos.get(row.id) ?? [],
      fishes: fishes.get(row.id) ?? [],
      createdAt: asIso(row.created_at),
    }));
  }

  async getSession(sessionId: string): Promise<CatchSessionRecord | null> {
    const sessionResult = await this.db.query(`
      SELECT cs.*, ${displayNameSql("creator")} AS created_by_name
      FROM catch_sessions cs
      JOIN users creator ON creator.telegram_user_id = cs.created_by_user_id
      WHERE cs.id = $1
    `, [sessionId]);
    const row = sessionResult.rows[0] as SessionDbRow | undefined;
    if (!row) return null;
    const fishResult = await this.db.query(`${this.catchSelectSql()} WHERE c.session_id = $1 ORDER BY c.id`, [sessionId]);
    const photos = (await this.photosForSessions([sessionId])).get(sessionId) ?? [];
    return {
      id: row.id,
      createdByUserId: asNumber(row.created_by_user_id),
      createdByName: row.created_by_name,
      latitude: row.latitude == null ? null : asNumber(row.latitude),
      longitude: row.longitude == null ? null : asNumber(row.longitude),
      waterbody: row.waterbody,
      caughtOn: asDateOnly(row.caught_on),
      lure: row.lure,
      disposition: row.disposition,
      notes: row.notes,
      photos,
      fishes: (fishResult.rows as CatchDbRow[]).map((fish) => mapCatch(fish, photos)),
      createdAt: asIso(row.created_at),
    };
  }

  async updateSessionDate(sessionId: string, caughtOn: string): Promise<boolean> {
    const result = await this.db.query(`
      UPDATE catch_sessions SET caught_on = $2 WHERE id = $1 RETURNING id
    `, [sessionId, caughtOn]);
    return result.rows.length > 0;
  }

  async updateSessionLocation(
    sessionId: string,
    latitude: number | null,
    longitude: number | null,
    waterbody: string | null,
  ): Promise<boolean> {
    const result = await this.db.query(`
      UPDATE catch_sessions
      SET latitude = $2, longitude = $3, waterbody = $4
      WHERE id = $1
      RETURNING id
    `, [sessionId, latitude, longitude, waterbody]);
    return result.rows.length > 0;
  }

  async updateSessionWaterbody(sessionId: string, waterbody: string | null): Promise<boolean> {
    const result = await this.db.query(`
      UPDATE catch_sessions SET waterbody = $2 WHERE id = $1 RETURNING id
    `, [sessionId, waterbody]);
    return result.rows.length > 0;
  }

  async updateFishSpecies(fishId: string, speciesName: string): Promise<boolean> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const fish = await client.query("SELECT user_id, species_id FROM catches WHERE id = $1 FOR UPDATE", [fishId]);
      const row = fish.rows[0];
      if (!row) { await client.query("ROLLBACK"); return false; }
      const normalized = speciesName.toLocaleLowerCase("ru-RU");
      const now = new Date().toISOString();
      await client.query(`
        INSERT INTO species (user_id, name, normalized_name, created_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT(user_id, normalized_name) DO UPDATE SET name = EXCLUDED.name
      `, [row.user_id, speciesName, normalized, now]);
      const target = await client.query("SELECT id FROM species WHERE user_id = $1 AND normalized_name = $2", [row.user_id, normalized]);
      const speciesId = target.rows[0]?.id;
      if (speciesId == null) throw new Error("Не удалось сохранить вид рыбы");
      await client.query("UPDATE catches SET species_id = $2 WHERE id = $1", [fishId, speciesId]);
      await client.query(`DELETE FROM species WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM catches WHERE species_id = $1)`, [row.species_id]);
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async updateFishWeight(fishId: string, weightGrams: number): Promise<boolean> {
    const result = await this.db.query("UPDATE catches SET weight_grams = $2 WHERE id = $1 RETURNING id", [fishId, weightGrams]);
    return result.rows.length > 0;
  }

  async updateFishLength(fishId: string, lengthMm: number | null): Promise<boolean> {
    const result = await this.db.query("UPDATE catches SET length_mm = $2 WHERE id = $1 RETURNING id", [fishId, lengthMm]);
    return result.rows.length > 0;
  }

  async updateFishAngler(fishId: string, anglerUserId: number): Promise<boolean> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const approved = await client.query("SELECT 1 AS ok FROM users WHERE telegram_user_id = $1 AND is_approved = TRUE", [anglerUserId]);
      if (!approved.rows[0]) { await client.query("ROLLBACK"); return false; }
      const fish = await client.query("SELECT species_id FROM catches WHERE id = $1 FOR UPDATE", [fishId]);
      const fishRow = fish.rows[0];
      if (!fishRow) { await client.query("ROLLBACK"); return false; }
      const species = await client.query("SELECT name, normalized_name FROM species WHERE id = $1", [fishRow.species_id]);
      const row = species.rows[0];
      if (!row) throw new Error("Не удалось найти вид рыбы");
      const now = new Date().toISOString();
      await client.query(`
        INSERT INTO species (user_id, name, normalized_name, created_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT(user_id, normalized_name) DO UPDATE SET name = EXCLUDED.name
      `, [anglerUserId, row.name, row.normalized_name, now]);
      const target = await client.query("SELECT id FROM species WHERE user_id = $1 AND normalized_name = $2", [anglerUserId, row.normalized_name]);
      const speciesId = target.rows[0]?.id;
      if (speciesId == null) throw new Error("Не удалось перенести вид рыбы новому рыбаку");
      await client.query("UPDATE catches SET user_id = $2, species_id = $3 WHERE id = $1", [fishId, anglerUserId, speciesId]);
      await client.query(`DELETE FROM species WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM catches WHERE species_id = $1)`, [fishRow.species_id]);
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const session = await client.query("SELECT id FROM catch_sessions WHERE id = $1 FOR UPDATE", [sessionId]);
      if (!session.rows[0]) { await client.query("ROLLBACK"); return false; }
      const species = await client.query("SELECT DISTINCT species_id FROM catches WHERE session_id = $1", [sessionId]);
      const deleted = await client.query("DELETE FROM catch_sessions WHERE id = $1 RETURNING id", [sessionId]);
      if (!deleted.rows[0]) throw new Error("Не удалось удалить улов");
      for (const row of species.rows) {
        await client.query(`DELETE FROM species WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM catches WHERE species_id = $1)`, [row.species_id]);
      }
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteFish(fishId: string): Promise<{ deleted: boolean; sessionId: string | null; sessionDeleted: boolean }> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const lookup = await client.query("SELECT session_id FROM catches WHERE id = $1", [fishId]);
      const lookupRow = lookup.rows[0];
      if (!lookupRow) { await client.query("ROLLBACK"); return { deleted: false, sessionId: null, sessionDeleted: false }; }
      const sessionId = String(lookupRow.session_id);
      const session = await client.query("SELECT id FROM catch_sessions WHERE id = $1 FOR UPDATE", [sessionId]);
      if (!session.rows[0]) { await client.query("ROLLBACK"); return { deleted: false, sessionId: null, sessionDeleted: false }; }
      const fish = await client.query("SELECT session_id, species_id FROM catches WHERE id = $1 FOR UPDATE", [fishId]);
      const row = fish.rows[0];
      if (!row) { await client.query("ROLLBACK"); return { deleted: false, sessionId: null, sessionDeleted: false }; }
      await client.query("DELETE FROM catches WHERE id = $1", [fishId]);
      const remaining = await client.query("SELECT 1 AS ok FROM catches WHERE session_id = $1 LIMIT 1", [sessionId]);
      let sessionDeleted = false;
      if (!remaining.rows[0]) {
        await client.query("DELETE FROM catch_sessions WHERE id = $1", [sessionId]);
        sessionDeleted = true;
      }
      await client.query(`DELETE FROM species WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM catches WHERE species_id = $1)`, [row.species_id]);
      await client.query("COMMIT");
      return { deleted: true, sessionId, sessionDeleted };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async addPhoto(
    sessionId: string,
    telegramFileId: string,
    telegramFileUniqueId: string,
  ): Promise<"added" | "duplicate" | "limit" | "missing"> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const session = await client.query("SELECT id FROM catch_sessions WHERE id = $1 FOR UPDATE", [sessionId]);
      if (!session.rows[0]) { await client.query("ROLLBACK"); return "missing"; }
      const photos = await client.query("SELECT telegram_file_unique_id, position FROM catch_photos WHERE session_id = $1 ORDER BY position", [sessionId]);
      if (photos.rows.some((row) => row.telegram_file_unique_id === telegramFileUniqueId)) { await client.query("ROLLBACK"); return "duplicate"; }
      if (photos.rows.length >= 10) { await client.query("ROLLBACK"); return "limit"; }
      const position = photos.rows.length ? Math.max(...photos.rows.map((row) => asNumber(row.position as string | number))) + 1 : 0;
      await client.query(`
        INSERT INTO catch_photos (id, session_id, telegram_file_id, telegram_file_unique_id, position)
        VALUES ($1, $2, $3, $4, $5)
      `, [randomUUID(), sessionId, telegramFileId, telegramFileUniqueId, position]);
      await client.query("COMMIT");
      return "added";
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async reorderPhotos(client: DatabaseClient, sessionId: string, orderedPhotoIds: string[]): Promise<void> {
    await client.query("UPDATE catch_photos SET position = position + 1000 WHERE session_id = $1", [sessionId]);
    for (const [position, id] of orderedPhotoIds.entries()) {
      await client.query("UPDATE catch_photos SET position = $3 WHERE id = $1 AND session_id = $2", [id, sessionId, position]);
    }
  }

  async setCoverPhoto(photoId: string): Promise<string | null> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query("SELECT session_id FROM catch_photos WHERE id = $1", [photoId]);
      const row = selected.rows[0];
      if (!row) { await client.query("ROLLBACK"); return null; }
      const sessionId = String(row.session_id);
      const session = await client.query("SELECT id FROM catch_sessions WHERE id = $1 FOR UPDATE", [sessionId]);
      if (!session.rows[0]) { await client.query("ROLLBACK"); return null; }
      const photos = await client.query("SELECT id FROM catch_photos WHERE session_id = $1 ORDER BY position", [sessionId]);
      if (!photos.rows.some((item) => String(item.id) === photoId)) { await client.query("ROLLBACK"); return null; }
      const ordered = [photoId, ...photos.rows.map((item) => String(item.id)).filter((id) => id !== photoId)];
      await this.reorderPhotos(client, sessionId, ordered);
      await client.query("COMMIT");
      return sessionId;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async deletePhoto(photoId: string): Promise<{ deleted: boolean; sessionId: string | null; reason?: "last" }> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query("SELECT session_id FROM catch_photos WHERE id = $1", [photoId]);
      const row = selected.rows[0];
      if (!row) { await client.query("ROLLBACK"); return { deleted: false, sessionId: null }; }
      const sessionId = String(row.session_id);
      const session = await client.query("SELECT id FROM catch_sessions WHERE id = $1 FOR UPDATE", [sessionId]);
      if (!session.rows[0]) { await client.query("ROLLBACK"); return { deleted: false, sessionId: null }; }
      const photos = await client.query("SELECT id FROM catch_photos WHERE session_id = $1 ORDER BY position", [sessionId]);
      if (!photos.rows.some((item) => String(item.id) === photoId)) { await client.query("ROLLBACK"); return { deleted: false, sessionId: null }; }
      if (photos.rows.length <= 1) { await client.query("ROLLBACK"); return { deleted: false, sessionId, reason: "last" }; }
      await client.query("DELETE FROM catch_photos WHERE id = $1", [photoId]);
      const remaining = photos.rows.map((item) => String(item.id)).filter((id) => id !== photoId);
      await this.reorderPhotos(client, sessionId, remaining);
      await client.query("COMMIT");
      return { deleted: true, sessionId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listRecords(): Promise<RecordRow[]> {
    const result = await this.db.query(`
      SELECT c.user_id, s.name AS species_name, s.normalized_name,
             ${displayNameSql("u")} AS owner_name, c.weight_grams, cs.caught_on, cs.created_at
      FROM catches c
      JOIN catch_sessions cs ON cs.id = c.session_id
      JOIN species s ON s.id = c.species_id
      JOIN users u ON u.telegram_user_id = c.user_id
      ORDER BY c.weight_grams DESC, cs.caught_on ASC, cs.created_at ASC
    `);
    const bestWeights = new Map<string, number>();
    for (const row of result.rows) {
      const name = String(row.normalized_name);
      if (!bestWeights.has(name)) bestWeights.set(name, asNumber(row.weight_grams as string | number));
    }
    const seen = new Set<string>();
    const records: RecordRow[] = [];
    for (const row of result.rows) {
      const name = String(row.normalized_name);
      const weight = asNumber(row.weight_grams as string | number);
      const key = `${name}\u0000${String(row.user_id)}`;
      if (weight !== bestWeights.get(name) || seen.has(key)) continue;
      seen.add(key);
      records.push({ speciesName: String(row.species_name), ownerName: String(row.owner_name), weightGrams: weight, caughtOn: asDateOnly(row.caught_on as Date | string) });
    }
    return records;
  }

  async listLeaderboard(): Promise<LeaderboardRow[]> {
    const [usersResult, catchesResult] = await Promise.all([
      this.db.query(`SELECT telegram_user_id AS user_id, ${displayNameSql("users")} AS owner_name FROM users WHERE is_approved = TRUE`),
      this.db.query(`
        SELECT c.user_id, c.weight_grams, s.normalized_name
        FROM catches c JOIN species s ON s.id = c.species_id
        JOIN catch_sessions cs ON cs.id = c.session_id
        ORDER BY c.weight_grams DESC, cs.caught_on ASC, cs.created_at ASC
      `),
    ]);
    const leaderboard = new Map<number, LeaderboardRow>();
    const speciesByUser = new Map<number, Set<string>>();
    for (const row of usersResult.rows) {
      const userId = asNumber(row.user_id as string | number);
      leaderboard.set(userId, { userId, ownerName: String(row.owner_name), catchesCount: 0, totalWeightGrams: 0, speciesCount: 0, recordsCount: 0 });
      speciesByUser.set(userId, new Set());
    }
    const bestWeights = new Map<string, number>();
    const awarded = new Set<string>();
    for (const row of catchesResult.rows) {
      const userId = asNumber(row.user_id as string | number);
      const stats = leaderboard.get(userId);
      if (!stats) continue;
      const speciesName = String(row.normalized_name);
      const weight = asNumber(row.weight_grams as string | number);
      stats.catchesCount += 1;
      stats.totalWeightGrams += weight;
      speciesByUser.get(userId)?.add(speciesName);
      const best = bestWeights.get(speciesName);
      if (best == null) bestWeights.set(speciesName, weight);
      const key = `${speciesName}\u0000${userId}`;
      if (weight === (best ?? weight) && !awarded.has(key)) { awarded.add(key); stats.recordsCount += 1; }
    }
    for (const [userId, stats] of leaderboard) stats.speciesCount = speciesByUser.get(userId)?.size ?? 0;
    return [...leaderboard.values()].sort((a, b) => b.recordsCount - a.recordsCount || b.totalWeightGrams - a.totalWeightGrams || b.catchesCount - a.catchesCount || a.ownerName.localeCompare(b.ownerName, "ru"));
  }

  async listSpeciesFilters(): Promise<LeaderboardFilterOption[]> {
    const result = await this.db.query(`
      SELECT MIN(s.id) AS id, s.name, s.normalized_name, COUNT(c.id) AS catches_count
      FROM species s JOIN catches c ON c.species_id = s.id
      GROUP BY s.normalized_name, s.name ORDER BY catches_count DESC, name LIMIT 30
    `);
    return result.rows.map((row) => ({ id: asNumber(row.id as string | number), name: String(row.name) }));
  }

  async listUserFilters(): Promise<LeaderboardFilterOption[]> {
    const result = await this.db.query(`
      SELECT telegram_user_id AS id, ${displayNameSql("users")} AS name
      FROM users WHERE is_approved = TRUE ORDER BY first_name, last_name
    `);
    return result.rows.map((row) => ({ id: asNumber(row.id as string | number), name: String(row.name) }));
  }

  async getSpeciesFilterName(speciesId: number): Promise<string | null> {
    const result = await this.db.query("SELECT name FROM species WHERE id = $1", [speciesId]);
    return result.rows[0]?.name == null ? null : String(result.rows[0].name);
  }

  async getUserFilterName(userId: number): Promise<string | null> {
    const result = await this.db.query(`
      SELECT ${displayNameSql("users")} AS name FROM users
      WHERE telegram_user_id = $1 AND is_approved = TRUE
    `, [userId]);
    return result.rows[0]?.name == null ? null : String(result.rows[0].name);
  }

  async listTopCatches(filter: CatchLeaderboardFilter, limit = 10): Promise<CatchRecord[]> {
    const values: unknown[] = [];
    const conditions: string[] = [];
    if (filter.speciesId != null) {
      values.push(filter.speciesId);
      conditions.push(`s.normalized_name = (SELECT normalized_name FROM species WHERE id = $${values.length})`);
    }
    if (filter.userId != null) { values.push(filter.userId); conditions.push(`c.user_id = $${values.length}`); }
    if (filter.metric === "length") conditions.push("c.length_mm IS NOT NULL");
    values.push(limit);
    const order = filter.metric === "length"
      ? "c.length_mm DESC, c.weight_grams DESC"
      : "c.weight_grams DESC, c.length_mm DESC NULLS LAST";
    const result = await this.db.query(`${this.catchSelectSql()}
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY ${order}, cs.caught_on ASC, cs.created_at ASC LIMIT $${values.length}
    `, values);
    return (result.rows as CatchDbRow[]).map((row) => mapCatch(row));
  }

  async isRecord(record: CatchRecord): Promise<boolean> {
    return await this.getBestWeight(record.speciesName) === record.weightGrams;
  }
}
