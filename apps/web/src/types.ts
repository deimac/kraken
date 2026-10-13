export type Transition = 'fade' | 'slide' | 'cut';
export type Role = 'admin' | 'partner_user' | 'advertiser' | 'player';
export type FrequencyLevel = 'low' | 'medium' | 'high';
export type CampaignStatus = 'active' | 'paused' | 'cancelled';
export type EffectiveStatus = 'paused' | 'cancelled' | 'scheduled' | 'active' | 'ended';
export type PieceStatus = 'pending_review' | 'approved' | 'rejected' | 'removed';

export interface User { id: string; email: string; role: Role; partnerId: string | null; advertiserId: string | null }
export interface Partner {
  id: string; name: string; slug: string; status: 'active' | 'inactive'; showInstitutional: boolean;
  weightLow: number; weightMedium: number; weightHigh: number; defaultImageSeconds: number; krakenPlanId: string | null;
  transition: Transition; transitionMs: number;
}
export interface KrakenPlan { id: string; name: string; description: string; priceCents: number | null; active: boolean }
export type PersonType = 'pf' | 'pj';
export interface Advertiser {
  id: string; name: string; personType: PersonType; document: string | null; legalName: string | null;
  contactName: string | null; email: string | null; phone: string | null; whatsapp: string | null;
  zip: string | null; street: string | null; number: string | null; complement: string | null;
  district: string | null; city: string | null; state: string | null; notes: string | null;
  source: 'manual' | 'self_signup'; archivedAt: string | null; activeCampaigns?: number;
}
export interface AdvertiserDetail {
  advertiser: Advertiser; playsThisMonth: number;
  campaigns: { id: string; name: string; status: CampaignStatus; effectiveStatus: EffectiveStatus; startsAt: string; endsAt: string }[];
}
export interface Plan {
  id: string; name: string; description: string; frequencyLevel: FrequencyLevel; active?: boolean;
  maxVideos: number; maxImages: number; maxVideoSeconds: number; priceCents: number; periodMonths: number;
}
/** A commercial campaign is a "subscription" (assinatura) in the panel: advertiser + plan + period, with pieces. */
export interface Campaign {
  id: string; kind: 'commercial' | 'institutional'; name: string; status: CampaignStatus; effectiveStatus: EffectiveStatus;
  startsAt: string; endsAt: string; frequencyLevel: FrequencyLevel; priceCents: number; paymentStatus: 'pending' | 'paid';
  advertiserId: string | null; advertiserName?: string; planName?: string; pieces?: { approved: number; pending: number };
}
export interface Piece {
  id: string; mediaType: 'image' | 'video'; mime: string; durationMs: number | null; displaySeconds: number | null;
  status: PieceStatus; reviewReason: string | null; originalName: string | null; createdAt: string;
  /** Videos: TV-optimized copy ready (smooth back-to-back playback), or why it failed. */
  tvReady?: boolean; tvError?: string | null;
}
export interface Review { action: string; reason: string | null; mediaId: string | null; createdAt: string }
export interface CampaignDetail {
  campaign: Campaign;
  plan: Pick<Plan, 'id' | 'name' | 'frequencyLevel' | 'maxVideos' | 'maxImages' | 'maxVideoSeconds' | 'periodMonths'> | null;
  pieces: Piece[]; usage: { videos: number; images: number }; reviews: Review[]; totalPlays: number;
}
export type InstitutionalCampaign = Omit<Campaign, 'pieces'> & { pieces: Piece[] };
export interface ReportCampaign {
  campaignId: string;
  name: string;
  kind: 'commercial' | 'institutional';
  advertiserName: string | null;
  total: number;
  days: { day: string; count: number }[];
  pieces: { mediaId: string; label: string; mediaType: 'image' | 'video'; total: number }[];
}
