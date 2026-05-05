export interface CapabilityQuotaInput {
  readonly scenarioId: string;
  readonly capabilityId: string;
  readonly estimatedUnits: number;
}

export class QuotaExceededError extends Error {
  readonly status = 402;
  readonly code = 'QUOTA_EXCEEDED';

  constructor(message: string) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

export function createPassThroughQuotaChecker() {
  return {
    async check(input: CapabilityQuotaInput): Promise<void> {
      if (!input.capabilityId) {
        throw new QuotaExceededError('capabilityId required for quota check');
      }
    },
  };
}
