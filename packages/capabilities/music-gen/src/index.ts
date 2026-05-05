import type { Capability } from '@open-design/capabilities-core';

export type MusicGenKind = 'music' | 'bed' | 'voiceover' | 'sfx';

export interface MusicGenInput {
  readonly prompt: string;
  readonly kind: MusicGenKind;
  readonly durationSec: number;
  readonly voiceId?: string;
  readonly language?: string;
}

export interface MusicGenOutput {
  readonly filePath: string;
  readonly mimeType: 'audio/mpeg' | 'audio/wav' | 'audio/ogg';
  readonly durationSec: number;
}

export type MusicGenCapability = Capability<MusicGenInput, MusicGenOutput>;
