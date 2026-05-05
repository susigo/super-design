// Core types for Open Design scenario packages. A scenario is a vertical
// product slice (frontend-design, ppt-design, instruction-manual, ...)
// that composes one or more capabilities.

import type { Capability } from '@open-design/capabilities-core';

export const SCENARIO_PROTOCOL_VERSION = 1 as const;

export type ScenarioMode = 'chat' | 'sketch' | 'spec';

export interface CapabilityRequirement {
  /** Capability id, e.g. 'image-gen'. */
  readonly id: string;
  /** SemVer range; orchestrator rejects scenarios whose capabilities don't match. */
  readonly version: string;
  /** Soft (false) requirements degrade gracefully; hard (true) requirements block the run. */
  readonly required: boolean;
}

export interface DesignSystemRequirement {
  readonly requires: boolean;
  readonly defaultId?: string;
}

export interface ScenarioManifest {
  readonly id: string;
  readonly version: string;
  readonly displayName: Readonly<Record<string, string>>;
  readonly capabilities: readonly CapabilityRequirement[];
  readonly designSystems: DesignSystemRequirement;
  readonly modes: readonly ScenarioMode[];
  readonly protocol: typeof SCENARIO_PROTOCOL_VERSION;
}

export interface ScenarioRunInput {
  readonly runId: string;
  readonly prompt: string;
  readonly attachments?: readonly string[];
  readonly designSystemId?: string;
  /** Optional skill id; the scenario picks a template based on it. */
  readonly skillId?: string;
}

export type ScenarioRunEvent =
  | {
      readonly type: 'capability:start';
      readonly capabilityId: string;
      readonly traceId: string;
    }
  | {
      readonly type: 'capability:end';
      readonly capabilityId: string;
      readonly traceId: string;
      readonly status: 'success' | 'error' | 'cancelled';
      readonly errorMessage?: string;
    }
  | {
      readonly type: 'artifact';
      readonly path: string;
      readonly mimeType: string;
    }
  | {
      readonly type: 'message';
      readonly role: 'assistant' | 'system';
      readonly content: string;
    }
  | {
      readonly type: 'error';
      readonly message: string;
    }
  | {
      readonly type: 'done';
    };

export interface CapabilityRegistry {
  /** Returns a typed capability if the manifest declared it; otherwise undefined. */
  get<I, O>(id: string): Capability<I, O> | undefined;
}

export interface Tracer {
  startInvocation(input: {
    runId: string;
    scenarioId: string;
    capabilityId: string;
    inputHash?: string;
  }): { traceId: string; finish: (outcome: TraceOutcome) => void };
}

export interface TraceOutcome {
  readonly status: 'success' | 'error' | 'cancelled';
  readonly provider?: string;
  readonly costUnits?: number;
  readonly costUsd?: number;
  readonly durationMs: number;
  readonly cached?: boolean;
  readonly errorMessage?: string;
}

export interface QuotaChecker {
  /** Throws if the run cannot proceed under the current quota. */
  check(input: { scenarioId: string; capabilityId: string; estimatedUnits: number }): Promise<void>;
}

export interface ScenarioContext {
  readonly capabilities: CapabilityRegistry;
  readonly tracer: Tracer;
  readonly quota: QuotaChecker;
}

export interface Scenario {
  readonly manifest: ScenarioManifest;
  run(
    input: ScenarioRunInput,
    ctx: ScenarioContext,
  ): AsyncIterable<ScenarioRunEvent>;
}
