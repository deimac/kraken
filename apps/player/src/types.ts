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
  /** TV-optimized copy (fragmented MP4 with the manifest's tvCodecs) and first-frame poster, when ready. */
  tvUrl?: string;
  posterUrl?: string;
}

export interface Item {
  campaignId: string;
  kind: 'commercial' | 'institutional';
  name: string;
  frequencyLevel: Level;
  media: MediaRef;
}

export interface Manifest {
  partner: { name: string; weights: Record<Level, number>; transition: Transition; transitionMs: number; refreshSeconds?: number; shuffle?: boolean };
  items: Item[];
  generatedAt: string;
  /** Server build; a change means a new player is available. */
  version?: string;
  /** Codecs shared by every tvUrl: lets the player append them into one MediaSource buffer. */
  tvCodecs?: string;
}
