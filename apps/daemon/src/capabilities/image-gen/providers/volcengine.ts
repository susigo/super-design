// @ts-nocheck
import { truncate } from '../../media-utils.js';
import { openaiSizeFor } from './openai.js';

export async function renderVolcengineImage(ctx, credentials) {
  if (!credentials.apiKey) {
    throw new Error('no Volcengine Ark API key — configure it in Settings or set ARK_API_KEY');
  }
  const baseUrl = (credentials.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '');

  const body = {
    model: ctx.model,
    prompt: ctx.prompt || 'A high-quality reference image.',
    response_format: 'b64_json',
    size: openaiSizeFor(ctx.model, ctx.aspect),
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
    throw new Error(`volcengine image ${resp.status}: ${truncate(text, 240)}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`volcengine image non-JSON: ${truncate(text, 200)}`);
  }
  const entry = data && Array.isArray(data.data) ? data.data[0] : null;
  if (!entry) throw new Error('volcengine image response had no data[0]');
  let bytes;
  if (entry.b64_json) {
    bytes = Buffer.from(entry.b64_json, 'base64');
  } else if (entry.url) {
    const imgResp = await fetch(entry.url);
    if (!imgResp.ok) throw new Error(`volcengine image fetch ${imgResp.status}`);
    bytes = Buffer.from(await imgResp.arrayBuffer());
  } else {
    throw new Error('volcengine image response missing b64_json/url');
  }
  return {
    bytes,
    providerNote: `volcengine/${ctx.model} · ${ctx.aspect} · ${bytes.length} bytes`,
    suggestedExt: '.png',
  };
}
