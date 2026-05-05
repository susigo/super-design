import { mkdir, writeFile, readFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScreenshotEntry, ScreenshotViewport } from '@open-design/contracts';

export interface ViewportConfig {
  label: ScreenshotViewport;
  width: number;
  height: number;
}

export const VIEWPORT_PRESETS: ViewportConfig[] = [
  { label: 'desktop', width: 1280, height: 800 },
  { label: 'tablet', width: 768, height: 1024 },
  { label: 'mobile', width: 375, height: 812 },
];

interface BrowserLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

interface PageLike {
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  goto(url: string, opts?: { waitUntil?: string }): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  screenshot(opts?: { fullPage?: boolean }): Promise<Buffer>;
  close(): Promise<void>;
}

let playwrightAvailable = false;
let browserInstance: BrowserLike | null = null;
let idleTimer: NodeJS.Timeout | null = null;

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

async function launchBrowser(): Promise<BrowserLike | null> {
  try {
    const pw = await import('playwright');
    const browser = await pw.chromium.launch({ headless: true });
    return browser as unknown as BrowserLike;
  } catch {
    return null;
  }
}

async function getBrowser(): Promise<BrowserLike | null> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  if (!browserInstance) {
    browserInstance = await launchBrowser();
  }

  resetIdleTimer();
  return browserInstance;
}

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    if (browserInstance) {
      await browserInstance.close().catch(() => {});
      browserInstance = null;
    }
  }, IDLE_TIMEOUT_MS);
}

export async function initScreenshotService(): Promise<boolean> {
  try {
    await import('playwright');
    playwrightAvailable = true;
  } catch {
    playwrightAvailable = false;
  }
  return playwrightAvailable;
}

export function isScreenshotAvailable(): boolean {
  return playwrightAvailable;
}

export async function captureScreenshot(
  url: string,
  viewport: ViewportConfig,
): Promise<Buffer | null> {
  const browser = await getBrowser();
  if (!browser) return null;

  const page = await browser.newPage();
  try {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    return await page.screenshot({ fullPage: false });
  } finally {
    await page.close();
  }
}

export async function captureProjectScreenshots(
  projectDir: string,
  projectId: string,
  artifactUrl: string,
  viewports?: ScreenshotViewport[],
): Promise<ScreenshotEntry[]> {
  const screenshotDir = join(projectDir, '.od', 'screenshots');
  await mkdir(screenshotDir, { recursive: true });

  const targets = viewports
    ? VIEWPORT_PRESETS.filter((v) => viewports.includes(v.label))
    : VIEWPORT_PRESETS;

  const timestamp = Date.now();
  const results: ScreenshotEntry[] = [];

  for (const vp of targets) {
    const buffer = await captureScreenshot(artifactUrl, vp);
    if (!buffer) continue;

    const fileName = `${timestamp}-${vp.label}.png`;
    await writeFile(join(screenshotDir, fileName), buffer);

    results.push({
      viewport: vp.label,
      width: vp.width,
      height: vp.height,
      fileName,
      timestamp,
    });
  }

  const manifestPath = join(screenshotDir, 'manifest.json');
  let manifest = { runId: undefined as string | undefined, projectId, screenshots: [] as ScreenshotEntry[], createdAt: timestamp };
  try {
    const existing = JSON.parse(await readFile(manifestPath, 'utf-8'));
    manifest = { ...existing, screenshots: [...existing.screenshots, ...results], createdAt: timestamp };
  } catch {
    manifest.screenshots = results;
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  return results;
}

export async function listScreenshots(projectDir: string): Promise<ScreenshotEntry[]> {
  const manifestPath = join(projectDir, '.od', 'screenshots', 'manifest.json');
  try {
    const data = JSON.parse(await readFile(manifestPath, 'utf-8'));
    return data.screenshots ?? [];
  } catch {
    return [];
  }
}

export async function getScreenshotPath(projectDir: string, fileName: string): Promise<string | null> {
  const filePath = join(projectDir, '.od', 'screenshots', fileName);
  try {
    await readFile(filePath);
    return filePath;
  } catch {
    return null;
  }
}

export async function shutdownScreenshotService(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
  }
}
