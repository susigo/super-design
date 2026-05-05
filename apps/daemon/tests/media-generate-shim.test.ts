import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  closeDatabase,
  listCapabilityInvocations,
  openDatabase,
} from '../src/db.js';
import { generateMedia } from '../src/media.js';

let tempDirs: string[] = [];
const originalAllowStubs = process.env.OD_MEDIA_ALLOW_STUBS;

afterEach(() => {
  closeDatabase();
  if (originalAllowStubs == null) {
    delete process.env.OD_MEDIA_ALLOW_STUBS;
  } else {
    process.env.OD_MEDIA_ALLOW_STUBS = originalAllowStubs;
  }
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('generateMedia image shim', () => {
  it('delegates image generation to the image capability and preserves metadata shape', async () => {
    process.env.OD_MEDIA_ALLOW_STUBS = '1';
    const root = tempRoot();
    const db = openDatabase(root, { dataDir: path.join(root, '.od') });

    const meta = await generateMedia({
      projectRoot: root,
      projectsRoot: path.join(root, '.od', 'projects'),
      projectId: 'project-1',
      surface: 'image',
      model: 'flux-1.1-pro',
      prompt: 'blue cube',
      output: 'sample.png',
      db,
      runId: 'run-1',
      scenarioId: 'legacy-media',
    });

    expect(meta).toMatchObject({
      name: 'sample.png',
      kind: 'image',
      mime: 'image/png',
      model: 'flux-1.1-pro',
      surface: 'image',
      providerId: 'bfl',
      intentionalStub: true,
      usedStubFallback: false,
      warnings: [],
    });
    expect(fs.existsSync(path.join(root, '.od', 'projects', 'project-1', 'sample.png'))).toBe(true);
    expect(listCapabilityInvocations(db, { runId: 'run-1' })).toHaveLength(1);
  });
});

function tempRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-media-shim-'));
  tempDirs.push(dir);
  return dir;
}
