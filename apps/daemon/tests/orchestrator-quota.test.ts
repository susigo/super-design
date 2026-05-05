import { describe, expect, it } from 'vitest';
import { createPassThroughQuotaChecker } from '../src/orchestrator/quota.js';

describe('pass-through quota checker', () => {
  it('allows known capability checks', async () => {
    await expect(createPassThroughQuotaChecker().check({
      scenarioId: 'legacy-media',
      capabilityId: 'image-gen',
      estimatedUnits: 1,
    })).resolves.toBeUndefined();
  });
});
