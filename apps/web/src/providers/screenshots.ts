import { daemonJson } from '../client/daemon-client';
import type { ScreenshotEntry } from '@open-design/contracts';

export type { ScreenshotEntry };

export async function fetchProjectScreenshots(projectId: string): Promise<ScreenshotEntry[]> {
  const body = await daemonJson<{ screenshots: ScreenshotEntry[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/screenshots`,
  );
  return body.screenshots ?? [];
}

export async function captureProjectScreenshot(projectId: string): Promise<void> {
  await daemonJson(`/api/projects/${encodeURIComponent(projectId)}/screenshots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}
