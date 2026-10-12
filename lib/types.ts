import type { CadenceResult } from "./cadence";
import type { ShadowBanFlag } from "./shadowban";

export interface ClientDTO {
  id: string;
  name: string;
  color: string;
  website: string | null;
  logoUrl: string | null;
  payMode: string; // uniform | individual
  defaultPayRules: string | null; // JSON PayRulesJson
  managementFee: number | null; // monthly, billed on invoices
  managementFeeStart: string | null;
  appleAppId: string | null; // App Store Connect app → downloads on the overview chart
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
  youtubeHandle: string | null;
  threadsHandle: string | null;
  facebookHandle: string | null;
  snapchatHandle: string | null;
  // tracking cutoff (YYYY-MM-DD at UTC midnight); ended = today is past it
  trackUntil: string | null;
  ended: boolean;
  expectedPerWeek: number;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  preferredChannel: string | null;
  phone: string | null;
  contactHandle: string | null;
  email: string | null;
  discord: string | null;
  discordChannel: string | null;
  whatsapp: string | null;
  sideshiftUrl: string | null;
  createdAt: string;
  viewsTotal: number;
  views30d: number;
  // reactions per view across their videos; null = no views to judge by
  engagementTotal: number | null;
  engagement30d: number | null;
  cadence: CadenceResult;
  // platforms that look shadow banned (under 10 views, 3+ posting days running)
  shadowBans: ShadowBanFlag[];
}

export interface OverviewResponse {
  summary: {
    total: number;
    ended: number; // finished creators, left out of the cadence tallies
    onTrack: number;
    behind: number;
    quiet: number;
    noData: number;
    shadowBanned: number;
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
  youtubeHandle: string | null;
  youtubeUrl: string | null;
  youtubeChannelId: string | null;
  threadsHandle: string | null;
  threadsUrl: string | null;
  facebookHandle: string | null;
  facebookUrl: string | null;
  facebookPageId: string | null;
  snapchatHandle: string | null;
  snapchatUrl: string | null;
  source: string;
  sourceDetail: string | null;
  sideshiftUrl: string | null;
  paymentMethod: string;
  paymentHandle: string | null;
  payRules: string | null; // JSON PayRulesJson — personal deal (individualized clients)
  phone: string | null;
  email: string | null;
  contactHandle: string | null;
  discord: string | null;
  discordChannel: string | null;
  whatsapp: string | null;
  preferredChannel: string | null;
  expectedPerWeek: number;
  status: string;
  onboardedAt: string | null;
  trackUntil: string | null; // last tracked day; posts after it are ignored
  notes: string | null;
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
  payExclusions: string | null;
  isWarmUp: boolean;
  payOverride: number | null;
  groupKey: string | null;
  groupPinned: boolean;
}

export interface CreatorDetailResponse {
  creator: CreatorDTO;
  cadence: CadenceResult;
  engagement30d: number | null;
  shadowBans: ShadowBanFlag[];
}
