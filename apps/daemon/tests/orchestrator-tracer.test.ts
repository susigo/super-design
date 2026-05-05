import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDatabase, getCapabilityInvocation, openDatabase } from '../src/db.js';
import { createCapabilityTracer } from '../src/orchestrator/tracer.js';

let tempDir: string | null = null;

afterEach(() => {
  closeDatabase();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('capability tracer', () => {
  it('records terminal invocation outcomes', () => {
    const db = createDb();
    const invocation = createCapabilityTracer(db).startInvocation({
      runId: 'run-1',
      scenarioId: 'legacy-media',
      capabilityId: 'image-gen',
      inputHash: 'openai:gpt-image-2:1:1',
    });

    invocation.finish({
      status: 'success',
      provider: 'openai',
      costUnits: 1,
      durationMs: 12,
      cached: false,
    });

    expect(getCapabilityInvocation(db, invocation.traceId)).toMatchObject({
      runId: 'run-1',
      scenarioId: 'legacy-media',
      capabilityId: 'image-gen',
      provider: 'openai',
      status: 'success',
      costUnits: 1,
      durationMs: 12,
    });
  });
});

function createDb() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-tracer-'));
  return openDatabase(tempDir, { dataDir: path.join(tempDir, '.od') });
}
