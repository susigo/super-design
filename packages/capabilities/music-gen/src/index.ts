import type { Capability } from '@open-design/capabilities-core';

export const MUSIC_GEN_CAPABILITY_ID = 'music-gen' as const;

export type MusicGenKind = 'music' | 'bed' | 'voiceover' | 'sfx';

export interface MusicGenInput {
  readonly prompt: string;
  readonly kind: MusicGenKind;
  /** Target duration in seconds; provider may clamp. */
  readonly durationSec: number;
  /** Optional voice id for voiceover. */
  readonly voiceId?: string;
  /** Optional language code, ISO-639-1 (e.g. 'en', 'zh'). */
  readonly language?: string;
}

export interface MusicGenOutput {
  /** File path under the project's `.od/` artifact folder. */
  readonly filePath: string;
  readonly mimeType: 'audio/mpeg' | 'audio/wav' | 'audio/ogg';
  readonly durationSec: number;
}

export type MusicGenCapability = Capability<MusicGenInput, MusicGenOutput>;
