export type DraftStep =
  | "media"
  | "count"
  | "angler"
  | "species"
  | "weight"
  | "length"
  | "location"
  | "waterbody"
  | "caught_on"
  | "lure"
  | "disposition"
  | "notes"
  | "preview";

export type Disposition = "released" | "kept" | "unknown";

export interface CatchPhotoDraft {
  telegramFileId: string;
  telegramFileUniqueId: string;
}

export interface CatchItemDraft {
  anglerUserId?: number;
  anglerName?: string;
  speciesName?: string;
  weightGrams?: number;
  lengthMm?: number;
}

export interface CatchDraft {
  fishCount?: number;
  currentFishIndex?: number;
  fishes?: CatchItemDraft[];
  latitude?: number;
  longitude?: number;
  waterbody?: string;
  caughtOn?: string;
  lure?: string;
  disposition?: Disposition;
  notes?: string;
  photos?: CatchPhotoDraft[];
  // Только для бесшовного чтения старых незавершённых черновиков.
  speciesName?: string;
  weightGrams?: number;
  lengthMm?: number;
  caughtAt?: string;
  mediaType?: "photo" | "video";
  telegramFileId?: string;
  telegramFileUniqueId?: string;
}

export interface DraftRecord {
  userId: number;
  step: DraftStep;
  data: CatchDraft;
}

export interface AnglerOption {
  id: number;
  displayName: string;
  username: string | null;
}

export interface CatchPhoto {
  id: string;
  telegramFileId: string;
  telegramFileUniqueId: string;
  position: number;
}

export interface CatchRecord {
  id: string;
  sessionId: string;
  userId: number;
  ownerName: string;
  createdByUserId: number;
  createdByName: string;
  speciesName: string;
  weightGrams: number;
  lengthMm: number | null;
  latitude: number | null;
  longitude: number | null;
  waterbody: string | null;
  caughtOn: string;
  lure: string | null;
  disposition: Disposition;
  notes: string | null;
  photos: CatchPhoto[];
  createdAt: string;
}

export interface CatchSessionRecord {
  id: string;
  createdByUserId: number;
  createdByName: string;
  latitude: number | null;
  longitude: number | null;
  waterbody: string | null;
  caughtOn: string;
  lure: string | null;
  disposition: Disposition;
  notes: string | null;
  photos: CatchPhoto[];
  fishes: CatchRecord[];
  createdAt: string;
}

export interface RecordRow {
  speciesName: string;
  ownerName: string;
  weightGrams: number;
  caughtOn: string;
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

export interface PreviousLocation {
  latitude: number;
  longitude: number;
  waterbody: string;
}
