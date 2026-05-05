import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  closeDatabase,
  listCapabilityInvocations,
  openDatabase,
} from '../src/db.js';
import { generateMusicCapability } from '../src/capabilities/music-gen/index.js';
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

function tempRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-music-gen-'));
  tempDirs.push(dir);
  return dir;
}

describe('generateMusicCapability', () => {
  it('writes an audio stub file and records a capability_invocations row', async () => {
    process.env.OD_MEDIA_ALLOW_STUBS = '1';
    const root = tempRoot();
    const db = openDatabase(root, { dataDir: path.join(root, '.od') });

    const meta = await generateMusicCapability({
      projectRoot: root,
      projectsRoot: path.join(root, '.od', 'projects'),
      projectId: 'proj-1',
      prompt: 'chill ambient background',
      kind: 'music',
      durationSec: 30,
      db,
      runId: 'run-music-1',
      scenarioId: 'ppt-design',
    });

    expect(meta).toMatchObject({
      surface: 'audio',
      audioKind: 'music',
      durationSec: 30,
      intentionalStub: true,
      usedStubFallback: false,
      warnings: [],
    });
    expect(meta.name).toMatch(/\.(mp3|wav|ogg)$/i);
    expect(fs.existsSync(path.join(root, '.od', 'projects', 'proj-1', meta.name))).toBe(true);

    const rows = listCapabilityInvocations(db, { runId: 'run-music-1' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      capabilityId: 'music-gen',
      scenarioId: 'ppt-design',
      status: 'success',
    });
  });

  it('clamps duration to the nearest allowed bucket', async () => {
    process.env.OD_MEDIA_ALLOW_STUBS = '1';
    const root = tempRoot();
    const db = openDatabase(root, { dataDir: path.join(root, '.od') });

    // 17s is not in the allowed list [5,10,15,30,60,120]; nearest is 15
    const meta = await generateMusicCapability({
      projectRoot: root,
      projectsRoot: path.join(root, '.od', 'projects'),
      projectId: 'proj-clamp',
      prompt: 'test',
      kind: 'music',
      durationSec: 17,
      db,
      runId: 'run-clamp',
      scenarioId: 'test',
    });

    expect(meta.durationSec).toBe(15);
  });

  it('maps "sfx" kind to the sfx audio sub-kind', async () => {
    process.env.OD_MEDIA_ALLOW_STUBS = '1';
    const root = tempRoot();
    const db = openDatabase(root, { dataDir: path.join(root, '.od') });

    const meta = await generateMusicCapability({
      projectRoot: root,
      projectsRoot: path.join(root, '.od', 'projects'),
      projectId: 'proj-sfx',
      prompt: 'explosion sound',
      kind: 'sfx',
      durationSec: 5,
      db,
      runId: 'run-sfx',
      scenarioId: 'test',
    });

    expect(meta.audioKind).toBe('sfx');
  });

  it('throws StubProviderDisabledError when stubs are not allowed', async () => {
    delete process.env.OD_MEDIA_ALLOW_STUBS;
    const root = tempRoot();
    const db = openDatabase(root, { dataDir: path.join(root, '.od') });

    await expect(
      generateMusicCapability({
        projectRoot: root,
        projectsRoot: path.join(root, '.od', 'projects'),
        projectId: 'proj-no-stub',
        prompt: 'ambient',
        kind: 'music',
        durationSec: 30,
        db,
        runId: 'run-no-stub',
        scenarioId: 'test',
      }),
    ).rejects.toThrow('provider not configured');
  });
});

describe('generateMedia music shim', () => {
  it('routes surface=audio/music through music-gen capability and records invocation', async () => {
    process.env.OD_MEDIA_ALLOW_STUBS = '1';
    const root = tempRoot();
    const db = openDatabase(root, { dataDir: path.join(root, '.od') });

    const meta = await generateMedia({
      projectRoot: root,
      projectsRoot: path.join(root, '.od', 'projects'),
      projectId: 'proj-media-shim',
      surface: 'audio',
      model: 'suno-v5',
      audioKind: 'music',
      prompt: 'upbeat background music',
      duration: 30,
      db,
      runId: 'run-media-music',
      scenarioId: 'ppt-design',
    });

    expect(meta).toMatchObject({
      surface: 'audio',
      model: 'suno-v5',
      intentionalStub: true,
    });
    expect(listCapabilityInvocations(db, { runId: 'run-media-music' })).toHaveLength(1);
  });
});
