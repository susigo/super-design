import { randomUUID } from 'node:crypto';

import {
  insertCapabilityInvocation,
  updateCapabilityInvocation,
} from '../db.js';

export type TraceOutcomeStatus = 'success' | 'error' | 'cancelled';

export interface StartInvocationInput {
  readonly runId: string;
  readonly scenarioId: string;
  readonly capabilityId: string;
  readonly inputHash?: string;
}

export interface TraceOutcome {
  readonly status: TraceOutcomeStatus;
  readonly provider?: string;
  readonly costUnits?: number;
  readonly costUsd?: number;
  readonly durationMs?: number;
  readonly cached?: boolean;
  readonly errorMessage?: string;
}

export function createCapabilityTracer(db: unknown) {
  return {
    startInvocation(input: StartInvocationInput) {
      const traceId = `cap_${randomUUID()}`;
      const startedAt = Date.now();
      let finished = false;

      return {
        traceId,
        finish(outcome: TraceOutcome) {
          if (finished) return;
          finished = true;
          const durationMs = outcome.durationMs ?? Date.now() - startedAt;
          insertCapabilityInvocation(db, {
            id: traceId,
            runId: input.runId,
            scenarioId: input.scenarioId,
            capabilityId: input.capabilityId,
            provider: outcome.provider,
            inputHash: input.inputHash,
            costUnits: outcome.costUnits,
            costUsd: outcome.costUsd,
            durationMs,
            status: outcome.status,
            errorMessage: outcome.errorMessage,
            cached: outcome.cached ?? false,
            createdAt: startedAt,
          });
        },
      };
    },
  };
}

export function recordCapabilityInvocation(db: unknown, input: StartInvocationInput, outcome: TraceOutcome) {
  const trace = createCapabilityTracer(db).startInvocation(input);
  trace.finish(outcome);
  return trace.traceId;
}

export function safeFinishCapabilityInvocation(
  db: unknown,
  traceId: string,
  outcome: Omit<TraceOutcome, 'durationMs'> & { readonly durationMs?: number },
) {
  try {
    return updateCapabilityInvocation(db, traceId, {
      provider: outcome.provider,
      costUnits: outcome.costUnits,
      costUsd: outcome.costUsd,
      durationMs: outcome.durationMs,
      status: outcome.status,
      errorMessage: outcome.errorMessage,
      cached: outcome.cached,
    });
  } catch {
    return null;
  }
}
