// Core types for Open Design capabilities. A capability is a reusable
// horizontal building block (image-gen, music-gen, voice-gen, ...) that
// scenarios compose. Capabilities never know which scenario calls them.

export const CAPABILITY_PROTOCOL_VERSION = 1 as const;

/**
 * Cost model declared by a capability. The orchestrator uses this to
 * estimate cost before a run starts and to record per-invocation cost
 * after a run finishes.
 */
export interface CostModel {
  /** Unit name shown to the user, e.g. 'image', 'second', 'token'. */
  readonly unit: string;
  /** Optional default unit price in USD; per-provider overrides may apply. */
  readonly defaultUsdPerUnit?: number;
}

/**
 * Static description of a capability. The same descriptor is returned by
 * `GET /api/capabilities` so the web UI can render provider pickers and
 * cost estimates.
 */
export interface CapabilityDescriptor {
  readonly id: string;
  readonly version: string;
  readonly protocol: typeof CAPABILITY_PROTOCOL_VERSION;
  readonly providers: readonly string[];
  readonly cost: CostModel;
}

/**
 * One invocation of a capability. `runId` matches the chat run id so
 * traces can be correlated end-to-end.
 */
export interface CapabilityInvocation<I> {
  readonly runId: string;
  readonly scenarioId: string;
  readonly input: I;
  readonly options?: CapabilityInvocationOptions;
}

/**
 * Structural alias for the parts of `AbortSignal` we actually consume.
 * Declaring it locally keeps this contract package off the DOM and
 * @types/node libs (mirrors the no-runtime-deps rule from `contracts`).
 */
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

export interface CapabilityCostBreakdown {
  readonly provider: string;
  readonly units: number;
  readonly usd?: number;
}

export interface CapabilityResult<O> {
  readonly output: O;
  readonly cost: CapabilityCostBreakdown;
  /** Per-invocation trace id; matches the `id` column in capability_invocations. */
  readonly traceId: string;
  readonly cached: boolean;
}

export interface CapabilityCostEstimate {
  readonly units: number;
  readonly usd?: number;
}

/**
 * The shape every capability implementation satisfies.
 *
 * Implementations live in `apps/daemon/src/capabilities/<id>/`. This
 * package only owns the contract.
 */
export interface Capability<I, O> {
  readonly descriptor: CapabilityDescriptor;
  invoke(call: CapabilityInvocation<I>): Promise<CapabilityResult<O>>;
  estimateCost(input: I): Promise<CapabilityCostEstimate>;
}

/** Status enum mirrored by the `capability_invocations.status` column. */
export type CapabilityInvocationStatus =
  | 'success'
  | 'error'
  | 'cancelled';
