import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createCapabilityTracer } from './tracer.js';
import { createPassThroughQuotaChecker } from './quota.js';

// ---------------------------------------------------------------------------
// Local type aliases that mirror packages/scenarios/core and
// packages/capabilities/core without importing those packages at runtime.
// The contracts packages export .ts source directly and are type-checked
// separately; here we re-declare the minimal structural shapes so runner.ts
// stays self-contained and avoids circular workspace build dependencies.
// ---------------------------------------------------------------------------

export interface CapabilityDescriptor {
  readonly id: string;
  readonly version: string;
  readonly providers: readonly string[];
}

export interface CapabilityInvocation<I> {
  readonly runId: string;
  readonly scenarioId: string;
  readonly input: I;
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

export interface Capability<I, O> {
  readonly descriptor: CapabilityDescriptor;
  invoke(call: CapabilityInvocation<I>): Promise<CapabilityResult<O>>;
  estimateCost(input: I): Promise<{ units: number; usd?: number }>;
}

export interface CapabilityRegistry {
  get<I, O>(id: string): Capability<I, O> | undefined;
}

export type ScenarioRunEventType =
  | { readonly type: 'capability:start'; readonly capabilityId: string; readonly traceId: string }
  | { readonly type: 'capability:end'; readonly capabilityId: string; readonly traceId: string; readonly status: 'success' | 'error' | 'cancelled'; readonly errorMessage?: string }
  | { readonly type: 'artifact'; readonly path: string; readonly mimeType: string }
  | { readonly type: 'message'; readonly role: 'assistant' | 'system'; readonly content: string }
  | { readonly type: 'error'; readonly message: string }
  | { readonly type: 'done' };

export interface ScenarioRunInput {
  readonly runId: string;
  readonly prompt: string;
  readonly attachments?: readonly string[];
  readonly designSystemId?: string;
  readonly skillId?: string;
}

export interface ScenarioManifest {
  readonly id: string;
  readonly version: string;
  readonly capabilities: readonly { readonly id: string; readonly version: string; readonly required: boolean }[];
}

export interface ScenarioTracer {
  startInvocation(input: {
    readonly runId: string;
    readonly scenarioId: string;
    readonly capabilityId: string;
    readonly inputHash?: string;
  }): { readonly traceId: string; readonly finish: (outcome: ScenarioTraceOutcome) => void };
}

export interface ScenarioTraceOutcome {
  readonly status: 'success' | 'error' | 'cancelled';
  readonly provider?: string;
  readonly costUnits?: number;
  readonly costUsd?: number;
  readonly durationMs?: number;
  readonly cached?: boolean;
  readonly errorMessage?: string;
}

export interface ScenarioQuotaChecker {
  check(input: { readonly scenarioId: string; readonly capabilityId: string; readonly estimatedUnits: number }): Promise<void>;
}

/** Extended context available to daemon-hosted scenario implementations. */
export interface DaemonScenarioContext {
  readonly capabilities: CapabilityRegistry;
  readonly tracer: ScenarioTracer;
  readonly quota: ScenarioQuotaChecker;
  /** Absolute path to the current project's files directory. */
  readonly projectDir: string;
  /**
   * Write a file into the project directory and return the absolute path.
   * `relPath` must not escape the project directory (path traversal is rejected).
   */
  writeArtifact(relPath: string, content: string | Buffer): Promise<string>;
}

export interface DaemonScenario {
  readonly manifest: ScenarioManifest;
  run(input: ScenarioRunInput, ctx: DaemonScenarioContext): AsyncIterable<ScenarioRunEventType>;
}

export interface ProjectContext {
  readonly projectRoot: string;
  readonly projectsRoot: string;
  readonly projectId: string;
  readonly projectDir: string;
  readonly db: unknown;
}

// ---------------------------------------------------------------------------
// SemVer caret-range check
// Supports the '^MAJOR' and '^MAJOR.MINOR' forms used in scenario manifests.
// A version satisfies '^N' when its major component equals N.
// ---------------------------------------------------------------------------

function satisfiesCaretRange(version: string, range: string): boolean {
  const caretMatch = range.match(/^\^(\d+)/);
  if (!caretMatch) return true; // unrecognised range: pass through
  const [vMajor] = version.split('.').map(Number);
  const reqMajor = Number(caretMatch[1]);
  return vMajor === reqMajor;
}

// ---------------------------------------------------------------------------
// Capability adapters
// Wraps the flat generateXxxCapability() functions in the Capability<I,O>
// interface so the scenario can call them uniformly through the registry.
// ---------------------------------------------------------------------------

// Dynamic imports avoid circular build-time issues; the modules exist at
// runtime since they live in the same daemon package.
async function buildCapabilityInstance(
  capabilityId: string,
  projectCtx: ProjectContext,
  db: unknown,
): Promise<Capability<unknown, unknown> | null> {
  if (capabilityId === 'image-gen') {
    const { generateImageCapability } = await import('../capabilities/image-gen/index.js') as {
      generateImageCapability: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };
    const descriptor: CapabilityDescriptor = {
      id: 'image-gen',
      version: '0.1.0',
      providers: ['openai', 'volcengine', 'grok'],
    };
    return {
      descriptor,
      async invoke(call: CapabilityInvocation<{ prompt: string; size?: string; style?: string; designSystemId?: string; negativePrompt?: string }>) {
        const aspect = sizeToAspect(call.input.size);
        const meta = await generateImageCapability({
          projectRoot: projectCtx.projectRoot,
          projectsRoot: projectCtx.projectsRoot,
          projectId: projectCtx.projectId,
          model: 'gpt-image-2',
          prompt: call.input.prompt,
          output: `slide-img-${Date.now().toString(36)}.png`,
          aspect,
          db,
          runId: call.runId,
          scenarioId: call.scenarioId,
        });
        const filePath = path.join(projectCtx.projectDir, (meta as { name: string }).name);
        return {
          output: { filePath, mimeType: 'image/png', width: 1024, height: 1024 },
          cost: { provider: String((meta as { providerId: string }).providerId), units: 1 },
          traceId: `img-${call.runId}-${Date.now()}`,
          cached: false,
        };
      },
      async estimateCost() {
        return { units: 1, usd: 0.04 };
      },
    };
  }

  if (capabilityId === 'music-gen') {
    const { generateMusicCapability } = await import('../capabilities/music-gen/index.js') as {
      generateMusicCapability: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };
    const descriptor: CapabilityDescriptor = {
      id: 'music-gen',
      version: '0.1.0',
      providers: ['suno', 'udio', 'google'],
    };
    return {
      descriptor,
      async invoke(call: CapabilityInvocation<{ prompt: string; kind?: string; durationSec?: number; voiceId?: string; language?: string }>) {
        const meta = await generateMusicCapability({
          projectRoot: projectCtx.projectRoot,
          projectsRoot: projectCtx.projectsRoot,
          projectId: projectCtx.projectId,
          prompt: call.input.prompt,
          kind: call.input.kind ?? 'music',
          durationSec: call.input.durationSec ?? 30,
          voiceId: call.input.voiceId,
          language: call.input.language,
          db,
          runId: call.runId,
          scenarioId: call.scenarioId,
        });
        const durationSec = (meta as { durationSec: number }).durationSec ?? 30;
        const filePath = path.join(projectCtx.projectDir, (meta as { name: string }).name);
        return {
          output: { filePath, mimeType: 'audio/mpeg', durationSec },
          cost: { provider: String((meta as { providerId: string }).providerId), units: durationSec },
          traceId: `music-${call.runId}-${Date.now()}`,
          cached: false,
        };
      },
      async estimateCost(input: { durationSec?: number }) {
        const units = input.durationSec ?? 30;
        return { units, usd: units * 0.01 };
      },
    };
  }

  return null;
}

function sizeToAspect(size: string | undefined): string {
  if (!size) return '16:9';
  if (size === '1536x1024' || size === '1792x1024') return '16:9';
  if (size === '1024x1536' || size === '1024x1792') return '9:16';
  if (size === '1408x1056') return '4:3';
  if (size === '1056x1408') return '3:4';
  return '1:1';
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export interface ScenarioRunner {
  run(
    scenario: DaemonScenario,
    input: ScenarioRunInput,
    projectCtx: ProjectContext,
  ): AsyncIterable<ScenarioRunEventType>;
}

export function createScenarioRunner(db: unknown): ScenarioRunner {
  return {
    run: async function* (
      scenario: DaemonScenario,
      input: ScenarioRunInput,
      projectCtx: ProjectContext,
    ): AsyncGenerator<ScenarioRunEventType> {
      const { manifest } = scenario;

      // Build capability registry, validating SemVer ranges.
      const capabilityMap = new Map<string, Capability<unknown, unknown>>();
      for (const req of manifest.capabilities) {
        const instance = await buildCapabilityInstance(req.id, projectCtx, db);
        if (!instance) {
          if (req.required) {
            yield { type: 'error', message: `required capability not available: ${req.id}` };
            return;
          }
          continue;
        }
        if (!satisfiesCaretRange(instance.descriptor.version, req.version)) {
          if (req.required) {
            yield {
              type: 'error',
              message: `capability ${req.id} version ${instance.descriptor.version} does not satisfy required range ${req.version}`,
            };
            return;
          }
          continue;
        }
        capabilityMap.set(req.id, instance);
      }

      const registry: CapabilityRegistry = {
        get<I, O>(id: string): Capability<I, O> | undefined {
          return capabilityMap.get(id) as Capability<I, O> | undefined;
        },
      };

      const tracer = db ? createCapabilityTracer(db) : {
        startInvocation(inp: { runId: string; scenarioId: string; capabilityId: string; inputHash?: string }) {
          const traceId = `noop-${Date.now()}`;
          return { traceId, finish: (_outcome: unknown) => { void inp; } };
        },
      };

      const quota = createPassThroughQuotaChecker();

      const writeArtifact = async (relPath: string, content: string | Buffer): Promise<string> => {
        const abs = path.resolve(projectCtx.projectDir, relPath);
        if (!abs.startsWith(projectCtx.projectDir + path.sep) && abs !== projectCtx.projectDir) {
          throw new Error(`writeArtifact: path "${relPath}" escapes the project directory`);
        }
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, content);
        return abs;
      };

      const ctx: DaemonScenarioContext = {
        capabilities: registry,
        tracer,
        quota,
        projectDir: projectCtx.projectDir,
        writeArtifact,
      };

      yield* scenario.run(input, ctx);
    },
  };
}
