import {
  CAPABILITY_PROTOCOL_VERSION,
  type Capability,
  type CapabilityDescriptor,
} from '@open-design/capabilities-core';

export type ImageGenSize = '512x512' | '1024x1024' | '1536x1024' | '1024x1536';

export interface ImageGenInput {
  readonly prompt: string;
  readonly size: ImageGenSize;
  readonly style?: string;
  readonly referenceImages?: readonly string[];
  readonly designSystemId?: string;
  readonly negativePrompt?: string;
}

export interface ImageGenOutput {
  readonly filePath: string;
  readonly mimeType: 'image/png' | 'image/webp' | 'image/jpeg';
  readonly width: number;
  readonly height: number;
}

export const IMAGE_GEN_CAPABILITY_ID = 'image-gen' as const;

export const imageGenCapabilityDescriptor: CapabilityDescriptor = {
  id: IMAGE_GEN_CAPABILITY_ID,
  version: '0.1.0',
  protocol: CAPABILITY_PROTOCOL_VERSION,
  providers: ['openai', 'volcengine', 'grok'],
  cost: { unit: 'image', defaultUsdPerUnit: 0.04 },
};

export type ImageGenCapability = Capability<ImageGenInput, ImageGenOutput>;
