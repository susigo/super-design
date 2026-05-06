import { daemonJson } from '../client/daemon-client';

export interface StagedDesignSystemFile {
  stagingId: string;
  kind: string;
  mime: string;
  size: number;
  originalName?: string;
}

export interface ExtractDesignSystemInput {
  stagingId: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  protocol: 'anthropic' | 'openai';
  hint?: string;
}

export async function stageDesignSystemImport(
  file: File,
): Promise<StagedDesignSystemFile> {
  const form = new FormData();
  form.append('file', file);
  return await daemonJson<StagedDesignSystemFile>(
    '/api/design-systems/import/stage',
    { method: 'POST', body: form },
  );
}

export async function extractDesignSystemImport(
  input: ExtractDesignSystemInput,
): Promise<{ slug: string; body: string }> {
  return await daemonJson<{ slug: string; body: string }>(
    '/api/design-systems/import/extract',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

export async function saveDesignSystemImport(input: {
  slug: string;
  body: string;
}): Promise<string> {
  const data = await daemonJson<{ ok: boolean; system?: { id?: string } }>(
    '/api/design-systems/import/save',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  return data.system?.id || input.slug;
}
