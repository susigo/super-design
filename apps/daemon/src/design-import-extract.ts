// @ts-nocheck
// Vision-based DESIGN.md extractor. Takes a staged source file (image,
// PDF, HTML, or ZIP) plus the user's BYOK creds and asks the upstream
// vision model to emit a structured 9-section design system via the
// `emit_design_md` tool. Streams progress / partial / final to the
// caller so the UI can render a live preview.
//
// Provider routing:
//   - protocol === 'anthropic' → POST <baseUrl>/v1/messages with
//     `tools` + `tool_choice: { type:'tool', name:'emit_design_md' }`
//   - protocol === 'openai'    → POST <baseUrl>/v1/chat/completions
//     with `tools` + `tool_choice: { type:'function', function:{ name } }`
//
// We deliberately skip streaming SSE here because tool-use payloads are
// final-shot anyway — there's no token-by-token to forward. The caller
// gets `{ kind: 'progress' | 'final' | 'error' }` events instead.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DESIGN_IMPORT_SYSTEM,
  DESIGN_MD_TOOL_SCHEMA,
  renderDesignMd,
  sanitizeDesignSystemSlug,
} from './prompts/design-import.js';

const TOOL_NAME = 'emit_design_md';
const REQUEST_TIMEOUT_MS = 90_000;

/**
 * Build the multimodal user content array. Supports a single staged
 * file. PDFs are sent as base64 attachments where the provider
 * supports them (Anthropic does as of Claude 3.5; OpenAI requires a
 * file upload step we skip in this MVP — caller must rasterize PDFs
 * client-side or fall back to HTML extraction).
 */
async function buildUserContent({ stagedPath, mime, hint, protocol }) {
  const bytes = await readFile(stagedPath);
  const lowMime = String(mime || '').toLowerCase();
  const isImage = lowMime.startsWith('image/');
  const isPdf = lowMime === 'application/pdf';
  const isHtml = lowMime === 'text/html' || lowMime.endsWith('+html');
  const summaryHint =
    typeof hint === 'string' && hint.trim()
      ? `\n\nUser hint: ${hint.trim().slice(0, 280)}`
      : '';

  if (isHtml) {
    const text = bytes.toString('utf8').slice(0, 200_000);
    const userText =
      'Analyze the following HTML page and extract the brand design system.\n' +
      summaryHint +
      '\n\n```html\n' +
      text +
      '\n```';
    return protocol === 'anthropic'
      ? [{ type: 'text', text: userText }]
      : [{ type: 'text', text: userText }];
  }

  if (isImage) {
    const b64 = bytes.toString('base64');
    if (protocol === 'anthropic') {
      return [
        {
          type: 'image',
          source: { type: 'base64', media_type: lowMime, data: b64 },
        },
        {
          type: 'text',
          text:
            'Analyze this brand asset and extract the design system.' +
            summaryHint,
        },
      ];
    }
    return [
      {
        type: 'image_url',
        image_url: { url: `data:${lowMime};base64,${b64}` },
      },
      {
        type: 'text',
        text:
          'Analyze this brand asset and extract the design system.' +
          summaryHint,
      },
    ];
  }

  if (isPdf && protocol === 'anthropic') {
    return [
      {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: bytes.toString('base64'),
        },
      },
      {
        type: 'text',
        text:
          'Analyze this brand PDF and extract the design system.' +
          summaryHint,
      },
    ];
  }

  // Fallback: treat as plain text (e.g. user dropped a markdown file).
  const text = bytes.toString('utf8').slice(0, 200_000);
  return [
    {
      type: 'text',
      text:
        'Analyze the following source and extract the design system.' +
        summaryHint +
        '\n\n```\n' +
        text +
        '\n```',
    },
  ];
}

async function callAnthropic({ baseUrl, apiKey, model, content }) {
  const clean = baseUrl.replace(/\/+$/, '');
  const url = /\/v\d+$/.test(clean) ? `${clean}/messages` : `${clean}/v1/messages`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        system: DESIGN_IMPORT_SYSTEM,
        tools: [
          {
            name: TOOL_NAME,
            description:
              'Emit a structured 9-section design system distilled from the source.',
            input_schema: DESIGN_MD_TOOL_SCHEMA,
          },
        ],
        tool_choice: { type: 'tool', name: TOOL_NAME },
        messages: [{ role: 'user', content }],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`anthropic ${res.status}: ${err.slice(0, 240)}`);
    }
    const data = await res.json();
    const block = (data?.content || []).find(
      (b) => b?.type === 'tool_use' && b?.name === TOOL_NAME,
    );
    if (!block) throw new Error('anthropic: no tool_use block in response');
    return { input: block.input, raw: data };
  } finally {
    clearTimeout(t);
  }
}

async function callOpenAI({ baseUrl, apiKey, model, content }) {
  const clean = baseUrl.replace(/\/+$/, '');
  const url = /\/v\d+$/.test(clean)
    ? `${clean}/chat/completions`
    : `${clean}/v1/chat/completions`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: DESIGN_IMPORT_SYSTEM },
          { role: 'user', content },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: TOOL_NAME,
              description:
                'Emit a structured 9-section design system distilled from the source.',
              parameters: DESIGN_MD_TOOL_SCHEMA,
            },
          },
        ],
        tool_choice: {
          type: 'function',
          function: { name: TOOL_NAME },
        },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`openai ${res.status}: ${err.slice(0, 240)}`);
    }
    const data = await res.json();
    const choice = (data?.choices || [])[0];
    const tc = choice?.message?.tool_calls?.[0];
    if (!tc?.function?.arguments) {
      throw new Error('openai: no tool_call in response');
    }
    let parsed;
    try {
      parsed = JSON.parse(tc.function.arguments);
    } catch (err) {
      throw new Error('openai: tool_call arguments not valid JSON');
    }
    return { input: parsed, raw: data };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Main entry. Returns `{ slug, body, raw }` on success.
 */
export async function extractDesignSystem({
  stagedPath,
  mime,
  hint,
  baseUrl,
  apiKey,
  model,
  protocol = 'anthropic',
}) {
  if (!stagedPath) throw new Error('stagedPath required');
  if (!baseUrl || !apiKey || !model) {
    const err = new Error('baseUrl, apiKey, and model are required');
    err.status = 400;
    throw err;
  }
  const content = await buildUserContent({ stagedPath, mime, hint, protocol });
  const result =
    protocol === 'openai'
      ? await callOpenAI({ baseUrl, apiKey, model, content })
      : await callAnthropic({ baseUrl, apiKey, model, content });
  const body = renderDesignMd(result.input);
  const slug = sanitizeDesignSystemSlug(
    result.input?.slug || path.basename(stagedPath, path.extname(stagedPath)),
  );
  return { slug, body, raw: result.raw };
}
