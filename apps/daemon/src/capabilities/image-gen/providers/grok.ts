// @ts-nocheck
import { truncate } from '../../media-utils.js';

export async function renderGrokImage(ctx, credentials) {
  if (!credentials.apiKey) {
    throw new Error(
      'no xAI API key — configure it in Settings or set XAI_API_KEY',
    );
  }
  const baseUrl = (credentials.baseUrl || 'https://api.x.ai/v1').replace(/\/$/, '');

  const aspectRatio = grokAspectFor(ctx.aspect);
  const body = {
    model: ctx.model,
    prompt: ctx.prompt || 'A high-quality reference image.',
    n: 1,
    aspect_ratio: aspectRatio,
    response_format: 'b64_json',
  };
  const resp = await fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${credentials.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`grok image ${resp.status}: ${truncate(text, 240)}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`grok image non-JSON: ${truncate(text, 200)}`);
  }
  const entry = data && Array.isArray(data.data) ? data.data[0] : null;
  if (!entry) throw new Error('grok image response had no data[0]');
  let bytes;
  if (entry.b64_json) {
    bytes = Buffer.from(entry.b64_json, 'base64');
  } else if (entry.url) {
    const imgResp = await fetch(entry.url);
    if (!imgResp.ok) throw new Error(`grok image fetch ${imgResp.status}`);
    bytes = Buffer.from(await imgResp.arrayBuffer());
  } else {
    throw new Error('grok image response missing b64_json/url');
  }
  const ext = sniffImageExt(bytes) || '.jpg';
  return {
    bytes,
    providerNote: `grok/${ctx.model} · ${aspectRatio} · ${bytes.length} bytes`,
    suggestedExt: ext,
  };
}

export function grokAspectFor(aspect) {
  if (
    aspect === '1:1'
    || aspect === '16:9'
    || aspect === '9:16'
    || aspect === '4:3'
    || aspect === '3:4'
  ) {
    return aspect;
  }
  return '16:9';
}

export function sniffImageExt(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return '.jpg';
  if (
    bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
  ) {
    return '.png';
  }
  if (
    bytes.slice(0, 4).toString('ascii') === 'RIFF'
    && bytes.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return '.webp';
  }
  return null;
}
