export const CAPABILITY_PROTOCOL_VERSION = 1 as const;

export interface CostModel {
  readonly unit: string;
  readonly defaultUsdPerUnit?: number;
}

export interface CapabilityDescriptor {
  readonly id: string;
  readonly version: string;
  readonly protocol: typeof CAPABILITY_PROTOCOL_VERSION;
  readonly providers: readonly string[];
  readonly cost: CostModel;
}

export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export interface CapabilityInvocationOptions {
  readonly provider?: string;
  readonly quotaToken?: string;
  readonly abortSignal?: AbortSignalLike;
}

export interface CapabilityInvocation<I> {
  readonly runId: string;
  readonly scenarioId: string;
  readonly input: I;
  readonly options?: CapabilityInvocationOptions;
}

export interface CapabilityCostBreakdown {
  readonly provider: string;
  readonly units: number;
  readonly usd?: number;
}

export interface CapabilityResult<O> {
  readonly output: O;
  readonly cost: CapabilityCostBreakdown;
  readonly traceId: string;
  readonly cached: boolean;
}

export interface CapabilityCostEstimate {
  readonly units: number;
  readonly usd?: number;
}

export interface Capability<I, O> {
  readonly descriptor: CapabilityDescriptor;
  invoke(call: CapabilityInvocation<I>): Promise<CapabilityResult<O>>;
  estimateCost(input: I): Promise<CapabilityCostEstimate>;
}

export type CapabilityInvocationStatus = 'success' | 'error' | 'cancelled';
