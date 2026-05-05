import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  closeDatabase,
  listCapabilityInvocations,
  openDatabase,
} from '../src/db.js';
import {
  createScenarioRunner,
  type DaemonScenario,
  type DaemonScenarioContext,
  type ScenarioRunEventType,
  type ScenarioRunInput,
} from '../src/orchestrator/runner.js';
import { pptDesignScenario } from '../src/scenarios/ppt-design/index.js';
import {
  buildCoverImagePrompt,
  buildBackgroundMusicPrompt,
  extractTitle,
} from '../src/scenarios/ppt-design/prompt-templates.js';
import { assemblePptHtml } from '../src/scenarios/ppt-design/post-process.js';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-scenario-runner-'));
  tempDirs.push(dir);
  return dir;
}

async function collectEvents(iter: AsyncIterable<ScenarioRunEventType>): Promise<ScenarioRunEventType[]> {
  const events: ScenarioRunEventType[] = [];
  for await (const e of iter) {
    events.push(e);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Prompt templates
// ---------------------------------------------------------------------------

describe('prompt-templates', () => {
  it('buildCoverImagePrompt includes the user prompt', () => {
    const result = buildCoverImagePrompt('AI in healthcare');
    expect(result).toContain('AI in healthcare');
    expect(result).toContain('presentation');
  });

  it('buildBackgroundMusicPrompt includes the user prompt', () => {
    const result = buildBackgroundMusicPrompt('startup pitch');
    expect(result).toContain('startup pitch');
    expect(result).toContain('music');
  });

  it('extractTitle returns the first sentence', () => {
    expect(extractTitle('Build AI products. More details here.')).toBe('Build AI products.');
  });

  it('extractTitle truncates at 60 chars', () => {
    const long = 'A'.repeat(80);
    expect(extractTitle(long).length).toBeLessThanOrEqual(60);
  });
});

// ---------------------------------------------------------------------------
// Post-process
// ---------------------------------------------------------------------------

describe('assemblePptHtml', () => {
  it('generates valid HTML with the title', () => {
    const html = assemblePptHtml({
      title: 'Test Deck',
      prompt: 'About testing',
      projectDir: '/tmp/proj',
    });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Test Deck');
    expect(html).toContain('About testing');
  });

  it('includes a relative image src when coverImageAbsPath is provided', () => {
    const html = assemblePptHtml({
      title: 'With Image',
      prompt: 'slide prompt',
      coverImageAbsPath: '/tmp/proj/cover.png',
      projectDir: '/tmp/proj',
    });
    expect(html).toContain("url('cover.png')");
  });

  it('includes audio element when musicAbsPath is provided', () => {
    const html = assemblePptHtml({
      title: 'With Audio',
      prompt: 'slide prompt',
      musicAbsPath: '/tmp/proj/bg.mp3',
      projectDir: '/tmp/proj',
    });
    expect(html).toContain('<audio');
    expect(html).toContain('bg.mp3');
  });

  it('escapes HTML special chars in title and prompt', () => {
    const html = assemblePptHtml({
      title: '<script>alert(1)</script>',
      prompt: '"hello" & <world>',
      projectDir: '/tmp/proj',
    });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });
});

// ---------------------------------------------------------------------------
// Runner — SemVer validation
// ---------------------------------------------------------------------------

describe('createScenarioRunner SemVer validation', () => {
  it('yields error when required capability version does not satisfy range', async () => {
    const root = tempRoot();
    const db = openDatabase(root, { dataDir: path.join(root, '.od') });
    const runner = createScenarioRunner(db);

    const incompatibleScenario: DaemonScenario = {
      manifest: {
        id: 'test-scenario',
        version: '0.1.0',
        // image-gen is at 0.1.0; requiring '^1' means major must be 1 → fail
        capabilities: [{ id: 'image-gen', version: '^1', required: true }],
      },
      async *run(_input: ScenarioRunInput, _ctx: DaemonScenarioContext) {
        yield { type: 'done' } as ScenarioRunEventType;
      },
    };

    const projectDir = path.join(root, '.od', 'projects', 'proj-semver');
    fs.mkdirSync(projectDir, { recursive: true });

    const events = await collectEvents(
      runner.run(incompatibleScenario, { runId: 'r1', prompt: 'test' }, {
        projectRoot: root,
        projectsRoot: path.join(root, '.od', 'projects'),
        projectId: 'proj-semver',
        projectDir,
        db,
      }),
    );

    expect(events.some((e) => e.type === 'error')).toBe(true);
    const errorEvent = events.find((e) => e.type === 'error') as { type: 'error'; message: string } | undefined;
    expect(errorEvent?.message).toMatch(/does not satisfy/);
  });

  it('continues when optional capability fails SemVer', async () => {
    process.env.OD_MEDIA_ALLOW_STUBS = '1';
    const root = tempRoot();
    const db = openDatabase(root, { dataDir: path.join(root, '.od') });
    const runner = createScenarioRunner(db);

    let scenarioRan = false;
    const scenario: DaemonScenario = {
      manifest: {
        id: 'test-scenario',
        version: '0.1.0',
        // music-gen optional with bad version range
        capabilities: [{ id: 'music-gen', version: '^9', required: false }],
      },
      async *run(_input: ScenarioRunInput, _ctx: DaemonScenarioContext) {
        scenarioRan = true;
        yield { type: 'done' } as ScenarioRunEventType;
      },
    };

    const projectDir = path.join(root, '.od', 'projects', 'proj-optional');
    fs.mkdirSync(projectDir, { recursive: true });

    const events = await collectEvents(
      runner.run(scenario, { runId: 'r2', prompt: 'test' }, {
        projectRoot: root,
        projectsRoot: path.join(root, '.od', 'projects'),
        projectId: 'proj-optional',
        projectDir,
        db,
      }),
    );

    expect(scenarioRan).toBe(true);
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Runner — ppt-design scenario (stub mode)
// ---------------------------------------------------------------------------

describe('pptDesignScenario via runner', () => {
  it('generates a presentation.html artifact and records capability invocations', async () => {
    // 15s: dynamic imports + filesystem I/O for the full ppt-design run
    process.env.OD_MEDIA_ALLOW_STUBS = '1';
    const root = tempRoot();
    const db = openDatabase(root, { dataDir: path.join(root, '.od') });
    const runner = createScenarioRunner(db);

    const projectDir = path.join(root, '.od', 'projects', 'proj-ppt');
    fs.mkdirSync(projectDir, { recursive: true });

    const events = await collectEvents(
      runner.run(pptDesignScenario, { runId: 'run-ppt-1', prompt: 'AI in healthcare' }, {
        projectRoot: root,
        projectsRoot: path.join(root, '.od', 'projects'),
        projectId: 'proj-ppt',
        projectDir,
        db,
      }),
    );

    // Must emit capability:start/end for image-gen
    expect(events.some((e) => e.type === 'capability:start' && (e as { capabilityId: string }).capabilityId === 'image-gen')).toBe(true);
    expect(events.some((e) => e.type === 'capability:end' && (e as { capabilityId: string; status: string }).status === 'success')).toBe(true);

    // Must emit artifact for the HTML file
    const artifactEvent = events.find((e) => e.type === 'artifact') as { type: 'artifact'; path: string; mimeType: string } | undefined;
    expect(artifactEvent).toBeDefined();
    expect(artifactEvent?.path).toBe('presentation.html');
    expect(artifactEvent?.mimeType).toBe('text/html');

    // Must end with done
    expect(events[events.length - 1]?.type).toBe('done');

    // HTML file must exist on disk
    expect(fs.existsSync(path.join(projectDir, 'presentation.html'))).toBe(true);

    // Must have at least 1 capability_invocations row (image-gen)
    const rows = listCapabilityInvocations(db, { runId: 'run-ppt-1' });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some((r: { capabilityId: string }) => r.capabilityId === 'image-gen')).toBe(true);
  }, 30000);

  it('pptDesignScenario manifest is correct', () => {
    expect(pptDesignScenario.manifest.id).toBe('ppt-design');
    expect(pptDesignScenario.manifest.capabilities).toHaveLength(2);
    const imageGenReq = pptDesignScenario.manifest.capabilities.find((c) => c.id === 'image-gen');
    expect(imageGenReq?.required).toBe(true);
    const musicGenReq = pptDesignScenario.manifest.capabilities.find((c) => c.id === 'music-gen');
    expect(musicGenReq?.required).toBe(false);
  });
});
