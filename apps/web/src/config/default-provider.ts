import type { KnownProvider } from '../state/config';

// Optional first-class "house provider" — the API gateway the
// maintainer of this build runs themselves. When configured, the
// welcome dialog shows a recommended fast-path card that asks only
// for an apiKey; baseUrl / protocol / default model are pre-filled.
//
// Two ways to set this:
//
//   1. Build-time env vars (preferred for binary distribution)
//        NEXT_PUBLIC_OD_HOUSE_PROVIDER_LABEL
//        NEXT_PUBLIC_OD_HOUSE_PROVIDER_BASE_URL
//        NEXT_PUBLIC_OD_HOUSE_PROVIDER_PROTOCOL    ('anthropic' | 'openai')
//        NEXT_PUBLIC_OD_HOUSE_PROVIDER_DEFAULT_MODEL
//        NEXT_PUBLIC_OD_HOUSE_PROVIDER_MODELS      (comma-separated)
//
//   2. Hard-coded fallback below — edit this file and commit. Useful
//      when distributing via `git clone` to colleagues.
//
// If LABEL or BASE_URL is empty, the export is `null` and the welcome
// dialog falls back to the standard Local CLI / Anthropic / OpenAI
// segmented control unchanged.

const FALLBACK: HouseProvider | null = null;
//   Example fallback for `git clone` distribution:
// const FALLBACK: HouseProvider | null = {
//   label: 'OD Cloud',
//   baseUrl: 'https://your-relay.example.com',
//   protocol: 'openai',
//   defaultModel: 'gpt-4o-mini',
//   models: ['gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4-6'],
// };

export interface HouseProvider extends KnownProvider {
  defaultModel: string;
}

export const DEFAULT_HOUSE_PROVIDER: HouseProvider | null = readEnvProvider() ?? FALLBACK;

function readEnvProvider(): HouseProvider | null {
  const label = (process.env.NEXT_PUBLIC_OD_HOUSE_PROVIDER_LABEL || '').trim();
  const baseUrl = (process.env.NEXT_PUBLIC_OD_HOUSE_PROVIDER_BASE_URL || '').trim();
  if (!label || !baseUrl) return null;
  const proto = (process.env.NEXT_PUBLIC_OD_HOUSE_PROVIDER_PROTOCOL || 'openai').trim();
  const protocol: 'anthropic' | 'openai' =
    proto === 'anthropic' ? 'anthropic' : 'openai';
  const defaultModel = (
    process.env.NEXT_PUBLIC_OD_HOUSE_PROVIDER_DEFAULT_MODEL || 'gpt-4o-mini'
  ).trim();
  const modelsCsv = (process.env.NEXT_PUBLIC_OD_HOUSE_PROVIDER_MODELS || '').trim();
  const models = modelsCsv
    ? modelsCsv
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean)
    : [defaultModel];
  return {
    label,
    protocol,
    baseUrl,
    model: defaultModel,
    defaultModel,
    models,
  };
}
