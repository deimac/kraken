export type Transition = 'fade' | 'slide' | 'cut';
export type Level = 'low' | 'medium' | 'high';

export interface MediaRef {
  id: string;
  url: string;
  mediaType: 'image' | 'video';
  mime: string;
  sha256: string;
  sizeBytes: number;
  durationMs: number | null;
  displaySeconds: number | null;
}

export interface Item {
  campaignId: string;
  kind: 'commercial' | 'institutional';
  name: string;
  frequencyLevel: Level;
  media: MediaRef;
}

export interface Manifest {
  partner: { name: string; weights: Record<Level, number>; transition: Transition; transitionMs: number; refreshSeconds?: number };
  items: Item[];
  generatedAt: string;
  /** Server build; a change means a new player is available. */
  version?: string;
}
