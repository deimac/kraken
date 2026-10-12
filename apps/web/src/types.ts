export type Transition = 'fade' | 'slide' | 'cut';
export type Role = 'admin' | 'partner_user' | 'advertiser' | 'player';
export type FrequencyLevel = 'low' | 'medium' | 'high';
export type CampaignStatus = 'draft' | 'pending_review' | 'changes_requested' | 'approved' | 'cancelled';
export type EffectiveStatus = CampaignStatus | 'scheduled' | 'active' | 'ended';

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
export interface Plan { id: string; name: string; description: string; frequencyLevel: FrequencyLevel; active?: boolean }
export interface Campaign {
  id: string; kind: 'commercial' | 'institutional'; name: string; status: CampaignStatus; effectiveStatus: EffectiveStatus;
  startsAt: string; endsAt: string; frequencyLevel: FrequencyLevel; currentMediaId: string | null;
  advertiserId: string | null; advertiserName?: string;
}
export interface Media { id: string; mediaType: 'image' | 'video'; mime: string; durationMs: number | null; displaySeconds: number | null }
export interface Review { action: 'submitted' | 'approved' | 'changes_requested' | 'cancelled'; reason: string | null; createdAt: string }
export interface CampaignDetail { campaign: Campaign; media: Media | null; reviews: Review[] }
export interface ReportCampaign {
  campaignId: string;
  name: string;
  kind: 'commercial' | 'institutional';
  advertiserName: string | null;
  total: number;
  days: { day: string; count: number }[];
}
