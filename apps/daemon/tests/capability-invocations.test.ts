import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  closeDatabase,
  getCapabilityInvocation,
  insertCapabilityInvocation,
  listCapabilityInvocations,
  openDatabase,
  updateCapabilityInvocation,
} from '../src/db.js';

let tempDir: string | null = null;

afterEach(() => {
  closeDatabase();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('capability invocation persistence', () => {
  it('inserts, updates, lists, and persists invocation rows', () => {
    const db = createDb();
    const inserted = insertCapabilityInvocation(db, {
      id: 'trace-1',
      runId: 'run-1',
      scenarioId: 'ppt-design',
      capabilityId: 'image-gen',
      provider: 'openai',
      inputHash: 'hash-1',
      status: 'success',
      cached: false,
      createdAt: 123,
    });

    expect(inserted).toMatchObject({
      id: 'trace-1',
      runId: 'run-1',
      scenarioId: 'ppt-design',
      capabilityId: 'image-gen',
      provider: 'openai',
      inputHash: 'hash-1',
      status: 'success',
      cached: false,
      createdAt: 123,
    });

    expect(updateCapabilityInvocation(db, 'trace-1', {
      costUnits: 1,
      costUsd: 0.04,
      durationMs: 250,
      cached: true,
    })).toMatchObject({
      id: 'trace-1',
      costUnits: 1,
      costUsd: 0.04,
      durationMs: 250,
      cached: true,
    });

    closeDatabase();
    const reopened = openDatabase(tempDir!, { dataDir: path.join(tempDir!, '.od') });
    expect(getCapabilityInvocation(reopened, 'trace-1')).toMatchObject({
      id: 'trace-1',
      cached: true,
      durationMs: 250,
    });
    expect(listCapabilityInvocations(reopened, { capabilityId: 'image-gen' })).toHaveLength(1);
  });
});

function createDb() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-capinv-'));
  return openDatabase(tempDir, { dataDir: path.join(tempDir, '.od') });
}
