import {
  CAPABILITY_PROTOCOL_VERSION,
  type Capability,
  type CapabilityDescriptor,
} from '@open-design/capabilities-core';

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

export const MUSIC_GEN_CAPABILITY_ID = 'music-gen' as const;

export const musicGenCapabilityDescriptor: CapabilityDescriptor = {
  id: MUSIC_GEN_CAPABILITY_ID,
  version: '0.1.0',
  protocol: CAPABILITY_PROTOCOL_VERSION,
  providers: ['suno', 'udio', 'google'],
  cost: { unit: 'second', defaultUsdPerUnit: 0.01 },
};

export type MusicGenCapability = Capability<MusicGenInput, MusicGenOutput>;
