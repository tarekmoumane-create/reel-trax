import type { CadenceResult } from "./cadence";

export interface ClientDTO {
  id: string;
  name: string;
  color: string;
  archived: boolean;
  createdAt: string;
  _count?: { creators: number };
}

export interface OverviewRow {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  status: string;
  source: string;
  tiktokHandle: string | null;
  instagramHandle: string | null;
  expectedPerWeek: number;
  lastContactedAt: string | null;
  followUpAt: string | null;
  needsFollowUp: boolean;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  preferredChannel: string | null;
  phone: string | null;
  contactHandle: string | null;
  cadence: CadenceResult;
}

export interface OverviewResponse {
  summary: {
    total: number;
    onTrack: number;
    behind: number;
    quiet: number;
    noData: number;
    needFollowUp: number;
  };
  rows: OverviewRow[];
  timeZone: string;
}

export interface CreatorDTO {
  id: string;
  clientId: string;
  displayName: string;
  avatarUrl: string | null;
  tiktokHandle: string | null;
  tiktokUrl: string | null;
  instagramHandle: string | null;
  instagramUrl: string | null;
  source: string;
  sourceDetail: string | null;
  sideshiftUrl: string | null;
  paymentMethod: string;
  paymentHandle: string | null;
  phone: string | null;
  email: string | null;
  contactHandle: string | null;
  discord: string | null;
  whatsapp: string | null;
  preferredChannel: string | null;
  expectedPerWeek: number;
  status: string;
  notes: string | null;
  lastContactedAt: string | null;
  followUpAt: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  createdAt: string;
  client?: ClientDTO;
  posts?: PostDTO[];
}

export interface PostDTO {
  id: string;
  platform: string;
  platformPostId: string;
  url: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
  postedAt: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  source: string;
}

export interface CreatorDetailResponse {
  creator: CreatorDTO;
  cadence: CadenceResult;
}
