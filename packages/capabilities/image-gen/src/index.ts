import type { Capability } from '@open-design/capabilities-core';

export const IMAGE_GEN_CAPABILITY_ID = 'image-gen' as const;

export type ImageGenSize =
  | '512x512'
  | '1024x1024'
  | '1536x1024'
  | '1024x1536';

export interface ImageGenInput {
  readonly prompt: string;
  readonly size: ImageGenSize;
  /** Free-form style hint, e.g. 'editorial', 'cyberpunk'. */
  readonly style?: string;
  /** Reference image file paths inside `.od/`. */
  readonly referenceImages?: readonly string[];
  /** Optional design-system id; the capability may inject DS tokens. */
  readonly designSystemId?: string;
  /** Negative prompt, where the underlying provider supports it. */
  readonly negativePrompt?: string;
}

export interface ImageGenOutput {
  /** File path under the project's `.od/` artifact folder. */
  readonly filePath: string;
  readonly mimeType: 'image/png' | 'image/webp' | 'image/jpeg';
  readonly width: number;
  readonly height: number;
}

export type ImageGenCapability = Capability<ImageGenInput, ImageGenOutput>;
