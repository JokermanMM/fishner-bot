export type DraftStep =
  | "media"
  | "count"
  | "species"
  | "weight"
  | "length"
  | "location"
  | "waterbody"
  | "caught_at"
  | "lure"
  | "disposition"
  | "notes"
  | "preview";

export type MediaType = "photo" | "video";
export type Disposition = "released" | "kept" | "unknown";

export interface CatchItemDraft {
  speciesName?: string;
  weightGrams?: number;
  lengthMm?: number;
}

export interface CatchDraft {
  fishCount?: number;
  currentFishIndex?: number;
  fishes?: CatchItemDraft[];
  speciesName?: string;
  weightGrams?: number;
  lengthMm?: number;
  latitude?: number;
  longitude?: number;
  waterbody?: string;
  caughtAt?: string;
  lure?: string;
  disposition?: Disposition;
  notes?: string;
  mediaType?: MediaType;
  telegramFileId?: string;
  telegramFileUniqueId?: string;
}

export interface DraftRecord {
  userId: number;
  step: DraftStep;
  data: CatchDraft;
}

export interface CatchRecord {
  id: string;
  userId: number;
  ownerName: string;
  speciesName: string;
  weightGrams: number;
  lengthMm: number | null;
  latitude: number | null;
  longitude: number | null;
  waterbody: string | null;
  caughtAt: string;
  lure: string | null;
  disposition: Disposition;
  notes: string | null;
  mediaType: MediaType | null;
  telegramFileId: string | null;
  telegramFileUniqueId: string | null;
  createdAt: string;
}

export interface RecordRow {
  speciesName: string;
  ownerName: string;
  weightGrams: number;
  caughtAt: string;
}

export interface LeaderboardRow {
  userId: number;
  ownerName: string;
  catchesCount: number;
  totalWeightGrams: number;
  speciesCount: number;
  recordsCount: number;
}

export interface LeaderboardFilterOption {
  id: number;
  name: string;
}

export type CatchLeaderboardMetric = "weight" | "length";

export interface CatchLeaderboardFilter {
  metric: CatchLeaderboardMetric;
  speciesId?: number;
  userId?: number;
}
