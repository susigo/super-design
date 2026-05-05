// @ts-nocheck
// Per-model pricing table for BYOK transparent metering.
//
// We keep three categories:
//   - text  : per-million-token rates (input / output / cached_read)
//   - image : per-image rates keyed by size string ("1024x1024" etc.)
//   - audio : per-second rates (TTS / STT)
//
// When a model isn't listed, callers should record cost_usd_estimate=null
// and cost_source='pricing-table-missing' so the UI can render '—'
// instead of a wrong number. Adding a model means a one-line entry here
// plus a source link in the PR description.
//
// Anthropic models that flow through the Claude Agent SDK already report
// `total_cost_usd` from the provider, so we only need to look this table
// up for OpenAI-compatible proxies and image generations.

const PER_MILLION = 1_000_000;

const TEXT_PRICING = {
  // OpenAI
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o-2024-08-06': { input: 2.5, output: 10.0 },
  'gpt-4o-mini-2024-07-18': { input: 0.15, output: 0.6 },
  'gpt-4.1': { input: 2.0, output: 8.0 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'o1': { input: 15.0, output: 60.0 },
  'o1-mini': { input: 3.0, output: 12.0 },
  'o3': { input: 2.0, output: 8.0 },
  'o3-mini': { input: 1.1, output: 4.4 },
  'o4-mini': { input: 1.1, output: 4.4 },

  // Anthropic via OpenAI-compatible proxy (rates copied from Anthropic
  // docs; the SDK path uses provider-supplied total_cost_usd instead).
  'claude-opus-4-7': { input: 15.0, output: 75.0 },
  'claude-opus-4-6': { input: 15.0, output: 75.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0 },

  // Common open / inference-cloud models seen in BYOK proxies
  'deepseek-chat': { input: 0.14, output: 0.28 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
  'qwen3-coder-plus': { input: 0.4, output: 1.6 },
  'kimi-k2': { input: 0.6, output: 2.5 },
};

const IMAGE_PRICING = {
  'gpt-image-2': {
    '1024x1024': 0.04,
    '1024x1536': 0.06,
    '1536x1024': 0.06,
    '1024x1792': 0.08,
    '1792x1024': 0.08,
  },
  'gpt-image-1': {
    '1024x1024': 0.04,
    '1024x1792': 0.08,
    '1792x1024': 0.08,
  },
  'dall-e-3': {
    '1024x1024': 0.04,
    '1024x1792': 0.08,
    '1792x1024': 0.08,
  },
  'dall-e-2': {
    '256x256': 0.016,
    '512x512': 0.018,
    '1024x1024': 0.02,
  },
};

const AUDIO_PRICING = {
  // OpenAI TTS — per million characters; we approximate by char count
  'tts-1': { kind: 'tts', per_million_chars: 15.0 },
  'tts-1-hd': { kind: 'tts', per_million_chars: 30.0 },
  // Whisper STT — per minute
  'whisper-1': { kind: 'stt', per_minute: 0.006 },
};

/**
 * Estimate the USD cost of a text completion call.
 * Returns null when the model isn't priced — caller should record
 * cost_source='pricing-table-missing' and surface as '—' in the UI.
 */
export function textPriceFor(
  model,
  { inputTokens = 0, outputTokens = 0, cachedReadTokens = 0 } = {},
) {
  if (!model) return null;
  const entry = TEXT_PRICING[model] ?? TEXT_PRICING[model.toLowerCase()];
  if (!entry) return null;
  const billableInput = Math.max(0, (inputTokens ?? 0) - (cachedReadTokens ?? 0));
  const cost =
    (billableInput * entry.input) / PER_MILLION +
    ((outputTokens ?? 0) * entry.output) / PER_MILLION;
  return Number.isFinite(cost) ? cost : null;
}

/**
 * Estimate the USD cost of one image generation. Falls back to the
 * smallest known size if the requested size isn't in the table — this
 * is best-effort, not a billing source of truth.
 */
export function imagePriceFor(model, size) {
  if (!model) return null;
  const entry = IMAGE_PRICING[model] ?? IMAGE_PRICING[model?.toLowerCase()];
  if (!entry) return null;
  if (size && entry[size] != null) return entry[size];
  // Fall back to the cheapest tier when size is unknown / unspecified.
  const fallback = Object.values(entry).sort((a, b) => a - b)[0];
  return typeof fallback === 'number' ? fallback : null;
}

/**
 * Estimate audio cost. `chars` for TTS, `seconds` for STT.
 */
export function audioPriceFor(model, { chars, seconds } = {}) {
  if (!model) return null;
  const entry = AUDIO_PRICING[model] ?? AUDIO_PRICING[model?.toLowerCase()];
  if (!entry) return null;
  if (entry.kind === 'tts' && typeof chars === 'number') {
    return (chars * entry.per_million_chars) / PER_MILLION;
  }
  if (entry.kind === 'stt' && typeof seconds === 'number') {
    return (seconds / 60) * entry.per_minute;
  }
  return null;
}

export function isModelPriced(model) {
  if (!model) return false;
  const lower = model.toLowerCase();
  return Boolean(
    TEXT_PRICING[model] ||
      TEXT_PRICING[lower] ||
      IMAGE_PRICING[model] ||
      IMAGE_PRICING[lower] ||
      AUDIO_PRICING[model] ||
      AUDIO_PRICING[lower],
  );
}
