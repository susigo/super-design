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
import { frontendDesignScenario } from '../src/scenarios/frontend-design/index.js';
import {
  buildHeroImagePrompt,
  extractPageTitle,
  extractPageSections,
} from '../src/scenarios/frontend-design/prompt-templates.js';
import { assembleWebPageHtml } from '../src/scenarios/frontend-design/post-process.js';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-frontend-design-'));
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
  it('buildHeroImagePrompt includes the user prompt', () => {
    const result = buildHeroImagePrompt('Modern SaaS landing page');
    expect(result).toContain('Modern SaaS landing page');
    expect(result.toLowerCase()).toMatch(/web|website|hero|banner/);
  });

  it('extractPageTitle returns the first sentence', () => {
    expect(extractPageTitle('Build amazing apps. More details.')).toBe('Build amazing apps.');
  });

  it('extractPageTitle truncates at 60 chars', () => {
    const long = 'A'.repeat(80);
    expect(extractPageTitle(long).length).toBeLessThanOrEqual(60);
  });

  it('extractPageSections extracts comma-separated items', () => {
    const result = extractPageSections('Features, Pricing, About us');
    expect(result).toEqual(['Features', 'Pricing', 'About us']);
  });

  it('extractPageSections returns defaults for vague prompt', () => {
    const result = extractPageSections('A cool website');
    expect(result).toBeInstanceOf(Array);
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Post-process
// ---------------------------------------------------------------------------

describe('assembleWebPageHtml', () => {
  it('generates valid HTML with the title', () => {
    const html = assembleWebPageHtml({
      title: 'Test Page',
      prompt: 'About testing',
      sections: ['Features', 'About'],
      projectDir: '/tmp/proj',
    });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Test Page');
    expect(html).toContain('About testing');
  });

  it('includes a relative image src when heroImageAbsPath is provided', () => {
    const html = assembleWebPageHtml({
      title: 'With Image',
      prompt: 'page prompt',
      sections: ['Features'],
      heroImageAbsPath: '/tmp/proj/hero.png',
      projectDir: '/tmp/proj',
    });
    expect(html).toContain("url('hero.png')");
  });

  it('renders section cards', () => {
    const sections = ['Features', 'Pricing', 'Contact'];
    const html = assembleWebPageHtml({
      title: 'Sections Test',
      prompt: 'test',
      sections,
      projectDir: '/tmp/proj',
    });
    for (const section of sections) {
      expect(html).toContain(section);
    }
  });

  it('escapes HTML special chars in title and prompt', () => {
    const html = assembleWebPageHtml({
      title: '<script>alert(1)</script>',
      prompt: '"hello" & <world>',
      sections: ['Test'],
      projectDir: '/tmp/proj',
    });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });
});

// ---------------------------------------------------------------------------
// Runner — frontend-design scenario (stub mode)
// ---------------------------------------------------------------------------

describe('frontendDesignScenario via runner', () => {
  it('generates a design.html artifact', async () => {
    process.env.OD_MEDIA_ALLOW_STUBS = '1';
    const root = tempRoot();
    const db = openDatabase(root, { dataDir: path.join(root, '.od') });
    const runner = createScenarioRunner(db);

    const projectDir = path.join(root, '.od', 'projects', 'proj-frontend');
    fs.mkdirSync(projectDir, { recursive: true });

    const events = await collectEvents(
      runner.run(frontendDesignScenario, { runId: 'run-frontend-1', prompt: 'Modern SaaS landing page' }, {
        projectRoot: root,
        projectsRoot: path.join(root, '.od', 'projects'),
        projectId: 'proj-frontend',
        projectDir,
        db,
      }),
    );

    expect(events.some((e) => e.type === 'capability:start' || e.type === 'capability:end')).toBe(true);

    const artifactEvent = events.find((e) => e.type === 'artifact') as { type: 'artifact'; path: string; mimeType: string } | undefined;
    expect(artifactEvent).toBeDefined();
    expect(artifactEvent?.path).toBe('design.html');
    expect(artifactEvent?.mimeType).toBe('text/html');

    expect(events[events.length - 1]?.type).toBe('done');

    expect(fs.existsSync(path.join(projectDir, 'design.html'))).toBe(true);
  }, 30000);

  it('frontendDesignScenario manifest is correct', () => {
    expect(frontendDesignScenario.manifest.id).toBe('frontend-design');
    expect(frontendDesignScenario.manifest.capabilities).toHaveLength(1);
    const imageGenReq = frontendDesignScenario.manifest.capabilities.find((c) => c.id === 'image-gen');
    expect(imageGenReq).toBeDefined();
    expect(imageGenReq?.required).toBe(false);
  });
});
