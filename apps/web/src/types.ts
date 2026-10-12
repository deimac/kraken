export type Role = 'admin' | 'partner_user' | 'advertiser' | 'player';
export type FrequencyLevel = 'low' | 'medium' | 'high';
export type CampaignStatus = 'draft' | 'pending_review' | 'changes_requested' | 'approved' | 'cancelled';
export type EffectiveStatus = CampaignStatus | 'scheduled' | 'active' | 'ended';

export interface User { id: string; email: string; role: Role; partnerId: string | null; advertiserId: string | null }
export interface Partner {
  id: string; name: string; slug: string; status: 'active' | 'inactive'; showInstitutional: boolean;
  weightLow: number; weightMedium: number; weightHigh: number; defaultImageSeconds: number;
}
export interface Advertiser { id: string; name: string; contactName: string | null; email: string | null; phone: string | null; source: 'manual' | 'self_signup' }
export interface Plan { id: string; name: string; description: string; frequencyLevel: FrequencyLevel; active?: boolean }
export interface Campaign {
  id: string; kind: 'commercial' | 'institutional'; name: string; status: CampaignStatus; effectiveStatus: EffectiveStatus;
  startsAt: string; endsAt: string; frequencyLevel: FrequencyLevel; currentMediaId: string | null;
  advertiserId: string | null; advertiserName?: string;
}
export interface Media { id: string; mediaType: 'image' | 'video'; mime: string; durationMs: number | null; displaySeconds: number | null }
export interface Review { action: 'submitted' | 'approved' | 'changes_requested' | 'cancelled'; reason: string | null; createdAt: string }
export interface CampaignDetail { campaign: Campaign; media: Media | null; reviews: Review[] }
