import { daemonJson, daemonOk } from '../client/daemon-client';

export type UsagePeriod = '7d' | '30d' | 'all';

export interface UsageSummary {
  period: string;
  daily: Array<{ date: string; calls: number; costUsd: number }>;
  bySurface: Record<string, { count: number; costUsd: number }>;
  byProvider: Record<string, { count: number; costUsd: number }>;
  total: { count: number; costUsd: number };
}

export interface UsageRecentRow {
  id: string;
  ts: number;
  surface: string;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  imageCount: number | null;
  costUsd: number | null;
  costSource: string;
  projectId: string | null;
}

export async function fetchUsageSummary(period: UsagePeriod): Promise<UsageSummary> {
  return await daemonJson<UsageSummary>(`/api/usage/summary?period=${period}`);
}

export async function fetchRecentUsage(limit: number): Promise<UsageRecentRow[]> {
  const body = await daemonJson<{ rows: UsageRecentRow[] }>(
    `/api/usage/recent?limit=${limit}`,
  );
  return Array.isArray(body.rows) ? body.rows : [];
}

export async function clearUsage(): Promise<void> {
  await daemonOk('/api/usage', { method: 'DELETE' });
}
