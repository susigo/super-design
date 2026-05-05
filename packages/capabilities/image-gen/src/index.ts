import type { Capability } from '@open-design/capabilities-core';

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

export type ImageGenCapability = Capability<ImageGenInput, ImageGenOutput>;
