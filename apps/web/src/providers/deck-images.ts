import { daemonJson } from '../client/daemon-client';

export interface DeckImagePromptTemplate {
  id: string;
  name: string;
  prompt: string;
  group: string;
}

export async function fetchDeckImagePromptTemplates(): Promise<DeckImagePromptTemplate[]> {
  const data = await daemonJson<{ templates?: unknown[]; items?: unknown[] } | unknown[]>(
    '/api/prompt-templates?surface=image',
  );
  const list = Array.isArray(data)
    ? data
    : Array.isArray(data.templates)
      ? data.templates
      : Array.isArray(data.items)
        ? data.items
        : [];
  return list.map(normalizeDeckImagePromptTemplate).filter(Boolean) as DeckImagePromptTemplate[];
}

export async function generateDeckImage(input: {
  projectId: string;
  placeholderId: string;
  prompt: string;
  aspect: string;
  conversationId: string | null;
  signal: AbortSignal;
}): Promise<string> {
  const data = await daemonJson<{ src: string }>(
    `/api/projects/${encodeURIComponent(input.projectId)}/deck/image`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        placeholderId: input.placeholderId,
        prompt: input.prompt,
        aspect: input.aspect,
        conversationId: input.conversationId,
      }),
      signal: input.signal,
    },
  );
  return data.src;
}

function normalizeDeckImagePromptTemplate(value: unknown): DeckImagePromptTemplate | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const id = typeof item.id === 'string' ? item.id : '';
  const prompt = typeof item.prompt === 'string' ? item.prompt : '';
  if (!id || !prompt) return null;
  return {
    id,
    name:
      typeof item.name === 'string'
        ? item.name
        : typeof item.title === 'string'
          ? item.title
          : id,
    prompt,
    group:
      typeof item.group === 'string'
        ? item.group
        : typeof item.category === 'string'
          ? item.category
          : 'General',
  };
}
