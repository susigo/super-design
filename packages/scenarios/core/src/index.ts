import type { Capability, CapabilityInvocationStatus } from '@open-design/capabilities-core';

export const SCENARIO_PROTOCOL_VERSION = 1 as const;

export type ScenarioMode = 'chat' | 'sketch' | 'spec';

export interface CapabilityRequirement {
  readonly id: string;
  readonly version: string;
  readonly required: boolean;
}

export interface ScenarioManifest {
  readonly id: string;
  readonly version: string;
  readonly displayName: Readonly<Record<string, string>>;
  readonly capabilities: readonly CapabilityRequirement[];
  readonly designSystems: { readonly requires: boolean; readonly defaultId?: string };
  readonly modes: readonly ScenarioMode[];
  readonly protocol: typeof SCENARIO_PROTOCOL_VERSION;
}

export interface ScenarioRunInput {
  readonly runId: string;
  readonly prompt: string;
  readonly attachments?: readonly string[];
  readonly designSystemId?: string;
  readonly skillId?: string;
}

export type ScenarioRunEvent =
  | { readonly type: 'capability:start'; readonly capabilityId: string; readonly traceId: string }
  | {
      readonly type: 'capability:end';
      readonly capabilityId: string;
      readonly traceId: string;
      readonly status: CapabilityInvocationStatus;
      readonly errorMessage?: string;
    }
  | { readonly type: 'artifact'; readonly path: string; readonly mimeType: string }
  | { readonly type: 'message'; readonly role: 'assistant' | 'system'; readonly content: string }
  | { readonly type: 'error'; readonly message: string }
  | { readonly type: 'done' };

export interface CapabilityRegistry {
  get<I, O>(id: string): Capability<I, O> | undefined;
}

export interface TraceOutcome {
  readonly status: CapabilityInvocationStatus;
  readonly provider?: string;
  readonly costUnits?: number;
  readonly costUsd?: number;
  readonly durationMs?: number;
  readonly cached?: boolean;
  readonly errorMessage?: string;
}

export interface Tracer {
  startInvocation(input: {
    readonly runId: string;
    readonly scenarioId: string;
    readonly capabilityId: string;
    readonly inputHash?: string;
  }): { readonly traceId: string; readonly finish: (outcome: TraceOutcome) => void };
}

export interface QuotaChecker {
  check(input: {
    readonly scenarioId: string;
    readonly capabilityId: string;
    readonly estimatedUnits: number;
  }): Promise<void>;
}

export interface ScenarioContext {
  readonly capabilities: CapabilityRegistry;
  readonly tracer: Tracer;
  readonly quota: QuotaChecker;
}

export interface Scenario {
  readonly manifest: ScenarioManifest;
  run(input: ScenarioRunInput, ctx: ScenarioContext): AsyncIterable<ScenarioRunEvent>;
}
