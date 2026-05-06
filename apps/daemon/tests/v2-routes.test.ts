import type http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer } from '../src/server.js';

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const started = await startServer({ port: 0, returnServer: true }) as {
    url: string;
    server: http.Server;
  };
  baseUrl = started.url;
  server = started.server;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('GET /api/v2/capabilities', () => {
  it('returns a list of capabilities', async () => {
    const resp = await fetch(`${baseUrl}/api/v2/capabilities`);
    expect(resp.ok).toBe(true);
    const body = (await resp.json()) as {
      capabilities: { id: string; version: string; providers: string[]; cost: { unit: string; defaultUsdPerUnit?: number } }[];
    };
    expect(body.capabilities).toBeInstanceOf(Array);
    expect(body.capabilities.length).toBeGreaterThanOrEqual(2);

    const imageGen = body.capabilities.find((c) => c.id === 'image-gen');
    expect(imageGen).toBeDefined();
    expect(imageGen!.version).toBe('0.1.0');
    expect(imageGen!.providers).toContain('openai');
    expect(imageGen!.cost.unit).toBe('image');

    const musicGen = body.capabilities.find((c) => c.id === 'music-gen');
    expect(musicGen).toBeDefined();
    expect(musicGen!.cost.unit).toBe('second');
  });
});

describe('GET /api/v2/scenarios', () => {
  it('returns a list of scenarios', async () => {
    const resp = await fetch(`${baseUrl}/api/v2/scenarios`);
    expect(resp.ok).toBe(true);
    const body = (await resp.json()) as {
      scenarios: {
        id: string;
        version: string;
        displayName: Record<string, string>;
        capabilities: { id: string; version: string; required: boolean }[];
        modes: string[];
      }[];
    };
    expect(body.scenarios).toBeInstanceOf(Array);
    expect(body.scenarios.length).toBeGreaterThanOrEqual(2);

    const ppt = body.scenarios.find((s) => s.id === 'ppt-design');
    expect(ppt).toBeDefined();
    expect(ppt!.displayName.en).toBe('PPT Design');
    expect(ppt!.capabilities.length).toBe(2);

    const frontend = body.scenarios.find((s) => s.id === 'frontend-design');
    expect(frontend).toBeDefined();
    expect(frontend!.displayName.en).toBe('Frontend Design');
    expect(frontend!.modes).toContain('chat');
    expect(frontend!.modes).toContain('sketch');
  });
});
