# Scenarios × Capabilities Architecture

| Field | Value |
|---|---|
| Status | Phase 0 ✅ landed (`51e5ae7`) · Phase 0.5 ✅ landed (`325197b`) · Phase 0.6 ✅ done · Phase 1 ✅ implemented · Phase 2 ✅ done · Phase 3 ✅ done · Phase 4 ✅ done · Phase 5 ✅ done |
| Owner | architecture |
| Last updated | 2026-05-06 |
| Target form | Mac + Windows desktop product (Electron). No Linux / Docker / SaaS targets in scope. |

This spec describes the layered architecture used to grow the daemon
from "前端设计 + PPT 设计" into a multi-scenario / multi-capability
product (说明书、3D 模型、视频…). It complements
`architecture-boundaries.md` (web/daemon/sidecar) by adding a
**vertical × horizontal** product layering inside the daemon.

---

## 1 — Motivation

Snapshot of the daemon at the time this spec was written:

- `apps/daemon/src/server.ts` ≈ **3584 lines** (single Express app)
- `apps/daemon/src/media.ts` ≈ **1690 lines** (image / music / voice mixed)
- `apps/daemon/src/agents.ts` ≈ **853 lines** (agent dispatch)

Top-level files are flat: `agents.ts`, `media.ts`, `craft.ts`,
`design-systems.ts`, `skills.ts` etc. As we add more scenarios and more
model providers, this layout will not hold.

Two orthogonal axes:

- **Scenario** = vertical slice = product-facing experience.
  *Examples*: `frontend-design`, `ppt-design`, `instruction-manual` (later),
  `3d-model` (later).
- **Capability** = horizontal building block = reusable atom.
  *Examples*: `image-gen`, `music-gen`, `voice-gen`, `layout-gen-web`,
  `layout-gen-slide`.

A scenario composes capabilities. A capability never knows which scenario
called it.

---

## 2 — Target architecture

```
packages/
├── contracts/                       (existing, kept)
├── capabilities/                    [Phase 0 ✅]
│   ├── core/                        Capability / Invocation / Cost / Result types
│   ├── image-gen/                   ImageGenInput / ImageGenOutput
│   ├── music-gen/                   MusicGenInput / MusicGenOutput
│   ├── voice-gen/                   [Phase 4]
│   ├── layout-gen-web/              [deferred — see §12]
│   └── layout-gen-slide/            [deferred — see §12]
└── scenarios/                       [Phase 0 ✅]
    ├── core/                        Scenario / ScenarioContext / event union
    ├── frontend-design/             manifest only [Phase 0 ✅]
    ├── ppt-design/                  manifest only [Phase 0 ✅]
    ├── instruction-manual/          [Phase 6+]
    └── 3d-model/                    [Phase 6+]

apps/daemon/src/
├── orchestrator/                    [Phase 1]
│   ├── runner.ts                    runs a scenario; injects capabilities
│   ├── tracer.ts                    writes capability_invocations rows
│   └── quota.ts                     pre-flight quota check
├── capabilities/                    [Phase 1+]
│   ├── image-gen/
│   │   ├── index.ts                 implements ImageGenCapability
│   │   ├── providers/openai.ts
│   │   ├── providers/anthropic.ts
│   │   ├── providers/tongyi.ts      [Phase 4+]
│   │   └── cache.ts
│   └── music-gen/                   [Phase 2]
├── scenarios/                       [Phase 2+]
│   ├── ppt-design/
│   │   ├── index.ts                 implements Scenario
│   │   ├── prompt-templates.ts
│   │   └── post-process.ts
│   └── frontend-design/             [Phase 4]
├── routes/                          [Phase 3] — server.ts split
│   ├── chat.ts
│   ├── artifacts.ts
│   ├── projects.ts
│   ├── capabilities.ts              GET /api/v2/capabilities (see §11)
│   └── scenarios.ts                 GET /api/v2/scenarios
├── server.ts                        target < 200 lines after Phase 3
└── (legacy flat files removed once shims are unused)
```

### Hard layering rules

- **Scenario impls** import only: capability interfaces from
  `packages/capabilities/*`, the orchestrator, prompt templates, and
  post-processing helpers local to the scenario.
- **Scenario impls** must NOT import: model SDKs (`openai`,
  `@anthropic-ai/sdk`, ...), other capabilities' provider files, other
  scenarios' internals, or the daemon HTTP layer.
- **Capability impls** import only: provider SDKs they own, the daemon
  DB module (for invocation logging / cache), and capability core.
- **Capability impls** must NOT import: scenarios, scenario prompt
  templates, or `server.ts`.
- **`packages/capabilities/*` and `packages/scenarios/*`** are pure
  TypeScript contract packages, just like `packages/contracts`. They
  must not depend on Next.js, Express, Node fs/process APIs, browser
  APIs, or daemon internals.
- ESLint `no-restricted-imports` enforces these in **Phase 5**.

---

## 3 — Capability contract

`packages/capabilities/core/src/index.ts` (landed in Phase 0):

```ts
export const CAPABILITY_PROTOCOL_VERSION = 1 as const;

export interface CostModel {
  readonly unit: string;                  // 'image' | 'second' | 'token'
  readonly defaultUsdPerUnit?: number;
}

export interface CapabilityDescriptor {
  readonly id: string;
  readonly version: string;               // SemVer
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
  readonly runId: string;                 // matches chat run id
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
  readonly traceId: string;               // = capability_invocations.id
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

export type CapabilityInvocationStatus =
  | 'success' | 'error' | 'cancelled';
```

### Concrete capabilities (Phase 0)

`@open-design/capabilities-image-gen`:

```ts
export type ImageGenSize =
  | '512x512' | '1024x1024' | '1536x1024' | '1024x1536';

export interface ImageGenInput {
  readonly prompt: string;
  readonly size: ImageGenSize;
  readonly style?: string;
  readonly referenceImages?: readonly string[];
  readonly designSystemId?: string;
  readonly negativePrompt?: string;
}

export interface ImageGenOutput {
  readonly filePath: string;              // under .od/
  readonly mimeType: 'image/png' | 'image/webp' | 'image/jpeg';
  readonly width: number;
  readonly height: number;
}

export type ImageGenCapability = Capability<ImageGenInput, ImageGenOutput>;
```

`@open-design/capabilities-music-gen`:

```ts
export type MusicGenKind = 'music' | 'bed' | 'voiceover' | 'sfx';

export interface MusicGenInput {
  readonly prompt: string;
  readonly kind: MusicGenKind;
  readonly durationSec: number;
  readonly voiceId?: string;
  readonly language?: string;
}

export interface MusicGenOutput {
  readonly filePath: string;
  readonly mimeType: 'audio/mpeg' | 'audio/wav' | 'audio/ogg';
  readonly durationSec: number;
}
```

---

## 4 — Scenario contract

`packages/scenarios/core/src/index.ts` (landed in Phase 0):

```ts
export const SCENARIO_PROTOCOL_VERSION = 1 as const;
export type ScenarioMode = 'chat' | 'sketch' | 'spec';

export interface CapabilityRequirement {
  readonly id: string;
  readonly version: string;               // SemVer range
  readonly required: boolean;
}

export interface ScenarioManifest {
  readonly id: string;
  readonly version: string;
  readonly displayName: Readonly<Record<string, string>>;
  readonly capabilities: readonly CapabilityRequirement[];
  readonly designSystems: { requires: boolean; defaultId?: string };
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
  | { type: 'capability:start'; capabilityId: string; traceId: string }
  | { type: 'capability:end'; capabilityId: string; traceId: string;
      status: 'success' | 'error' | 'cancelled'; errorMessage?: string }
  | { type: 'artifact'; path: string; mimeType: string }
  | { type: 'message'; role: 'assistant' | 'system'; content: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface CapabilityRegistry {
  get<I, O>(id: string): Capability<I, O> | undefined;
}

export interface Tracer {
  startInvocation(input: {
    runId: string; scenarioId: string;
    capabilityId: string; inputHash?: string;
  }): { traceId: string; finish: (outcome: TraceOutcome) => void };
}

export interface QuotaChecker {
  check(input: {
    scenarioId: string; capabilityId: string; estimatedUnits: number;
  }): Promise<void>;
}

export interface ScenarioContext {
  readonly capabilities: CapabilityRegistry;
  readonly tracer: Tracer;
  readonly quota: QuotaChecker;
}

export interface Scenario {
  readonly manifest: ScenarioManifest;
  run(input: ScenarioRunInput,
      ctx: ScenarioContext): AsyncIterable<ScenarioRunEvent>;
}
```

### Scenario manifests (Phase 0)

```ts
// frontend-design
export const frontendDesignManifest: ScenarioManifest = {
  id: 'frontend-design',
  version: '0.1.0',
  protocol: SCENARIO_PROTOCOL_VERSION,
  displayName: { en: 'Frontend Design', 'zh-CN': '前端设计' },
  capabilities: [{ id: 'image-gen', version: '^0', required: false }],
  designSystems: { requires: true, defaultId: 'default' },
  modes: ['chat', 'sketch'],
};

// ppt-design
export const pptDesignManifest: ScenarioManifest = {
  id: 'ppt-design',
  version: '0.1.0',
  protocol: SCENARIO_PROTOCOL_VERSION,
  displayName: { en: 'PPT Design', 'zh-CN': 'PPT 设计' },
  capabilities: [
    { id: 'image-gen', version: '^0', required: true },
    { id: 'music-gen', version: '^0', required: false },
  ],
  designSystems: { requires: true, defaultId: 'default' },
  modes: ['chat'],
};
```

---

## 5 — Skill manifest extension

`SKILL.md` already carries `od.scenario`. We add `od.capabilities_used`:

```yaml
od:
  scenario: ppt-design
  capabilities_used:
    - id: image-gen
      version: '^1'
      required: true
    - id: layout-gen-slide
      version: '^0'
      required: true
    - id: music-gen
      required: false
  design_system:
    requires: true
    fallback: default
```

The field is optional during the migration; loaders fall back to
inferring from `od.mode`. Backfilling all 48 skills happens in Phase 2,
via a one-shot script + manual review.

---

## 6 — Database

Two new tables added to `apps/daemon/src/db.ts` migrate(). Both use
`CREATE TABLE IF NOT EXISTS`, so older `.od/app.sqlite` files upgrade in
place with no manual step.

### 6.1 `schema_version` — landed in Phase 0 ✅

```sql
CREATE TABLE IF NOT EXISTS schema_version (
  version    INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (1, ...);
```

Single-row baseline for the next migration step (full migration
framework lands in a follow-up; the table itself is needed now to make
that follow-up safe).

### 6.2 `capability_invocations` — landed in Phase 0 ✅

```sql
CREATE TABLE IF NOT EXISTS capability_invocations (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL,
  scenario_id   TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  provider      TEXT,
  input_hash    TEXT,
  cost_units    REAL,
  cost_usd      REAL,
  duration_ms   INTEGER,
  status        TEXT NOT NULL,   -- 'success' | 'error' | 'cancelled'
  error_message TEXT,
  cached        INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_capinv_run
  ON capability_invocations(run_id);
CREATE INDEX IF NOT EXISTS idx_capinv_scenario
  ON capability_invocations(scenario_id, created_at DESC);
```

Used for: per-run debug trace UI, per-tenant usage / billing, and
cache lookup via `input_hash`.

> Note: existing `usage_logs` table tracks token-level model usage and
> is **not** replaced. `capability_invocations` is one-row-per-capability-
> call, while `usage_logs` is one-row-per-model-call. A single capability
> invocation may produce zero or more usage_logs rows.

---

## 7 — Protocol version

`packages/contracts/src/protocol.ts` (landed in Phase 0):

```ts
export const PROTOCOL_VERSION = {
  contracts: 1,
  capabilities: 1,
  scenarios: 1,
} as const;
```

In **Phase 1**, daemon `GET /api/version` reports this triple alongside
the existing `AppVersionInfo`. Web compares the daemon-reported triple
to its compile-time copy and flags an upgrade hint when they disagree
(relevant for auto-update windows).

---

## 8 — Phased rollout

| Phase | Target window | Status | Scope |
|---|---|---|---|
| **0 — scaffold** | Week 1 | ✅ **DONE** (`51e5ae7`) | Empty contract packages, `PROTOCOL_VERSION`, two new DB tables. Behavior unchanged. |
| **0.5 — fix daemon typecheck baseline** | inserted | ✅ **DONE** (`325197b`) | ESM extensions + optional playwright fixed; `pnpm typecheck` green. |
| **0.6 — restore DB tables** | inserted | ✅ **DONE** | `schema_version` + `capability_invocations` removed by `4d72773`; restored before Phase 1. |
| **1 — first capability** | Week 2 | ✅ implemented | `image-gen` impl extracted from `media.ts`; old shims still serve callers; invocations logged. |
| **2 — first scenario** | Week 3 | ✅ **DONE** | `music-gen` extracted; `ppt-design` scenario routes through orchestrator; SKILL.md `capabilities_used` filled. |
| **3 — split server.ts** | Week 4 | ✅ **DONE** | `apps/daemon/src/routes/*` carved out. No business changes. |
| **4 — second scenario** | Week 5 | ✅ **DONE** | `frontend-design` scenario. UI consumes `/api/v2/scenarios` + `/api/v2/capabilities`. |
| **5 — guardrails** | Week 6 | ✅ **DONE** | ESLint boundary rules; capability/scenario SemVer guardrail; docs update. |

Phase 0 is behavior-neutral; Phases 1–4 progressively replace flat
files with the new layout while keeping callers working through shims.

### Phase 0 — DONE

Acceptance: ✅ all items met at commit `51e5ae7`.

- [x] `packages/capabilities/{core,image-gen,music-gen}` scaffolded
- [x] `packages/scenarios/{core,frontend-design,ppt-design}` scaffolded
- [x] `pnpm-workspace.yaml` updated with nested globs
- [x] `packages/contracts/src/protocol.ts` exports `PROTOCOL_VERSION`
- [x] `apps/daemon/src/db.ts` adds `schema_version` and `capability_invocations` tables
- [x] `packages/AGENTS.md` documents new package responsibilities
- [x] `pnpm install` succeeds (18 workspace projects)
- [x] `pnpm typecheck` on new packages + contracts + web all green
- [x] sidecar / sidecar-proto / platform tests still green (24/24)
- [x] better-sqlite3 smoke verifies new tables + indexes + version row insert

> **⚠ Regression:** commit `4d72773` (between Phase 0 and 0.5) removed the
> `schema_version` and `capability_invocations` DDL from `db.ts` along with
> ~77 lines from `server.ts`. The contract packages, workspace config, and
> protocol version are unaffected. Phase 0.6 restores the DB tables.

### Phase 0.5 — fix daemon typecheck baseline — DONE

Commit `325197b` resolved the pre-existing typecheck failures left by
`5f17cce` on `main`.

- [x] Contracts ESM extension errors fixed: added `.js` extensions to
      all relative imports in `packages/contracts/src/**` for NodeNext
      module resolution compatibility.
- [x] Playwright import shape decided: string indirection
      (`const PLAYWRIGHT_MODULE = 'playwright'`) + runtime
      `await import(PLAYWRIGHT_MODULE)` with graceful catch, avoiding
      compile-time TS2307 while keeping playwright optional.
- [x] `pnpm --filter @open-design/daemon typecheck` green.
- [x] `pnpm typecheck` (root) green across all 18 workspace projects.

### Phase 0.6 — restore DB tables — DONE

Commit `4d72773` accidentally removed the `schema_version` and
`capability_invocations` DDL that Phase 0 added to `db.ts`. The tables
have been restored before Phase 1 so the tracer can use
`capability_invocations`.

- [x] Re-add `schema_version` DDL to `apps/daemon/src/db.ts` migrate()
      (see §6.1 for schema)
- [x] Re-add `capability_invocations` DDL + both indexes to
      `apps/daemon/src/db.ts` migrate() (see §6.2 for schema)
- [x] Re-add `INSERT OR IGNORE INTO schema_version` baseline row
- [x] Verify: `pnpm --filter @open-design/daemon typecheck` green
- [x] Verify: `pnpm --filter @open-design/daemon test` green
- [x] Verify: better-sqlite3 smoke confirms tables + indexes + version row

### Phase 1 — image-gen capability — IMPLEMENTED

- [x] Create `apps/daemon/src/capabilities/image-gen/{index.ts,
      providers/openai.ts, providers/volcengine.ts, providers/grok.ts}`
- [x] Restore pure contract packages under `packages/capabilities/*`
      and `packages/scenarios/*` so daemon imports do not invent local
      contract types
- [x] Move OpenAI / Volcengine / Grok image-generation paths from
      `media.ts` into provider files (no public API change)
- [x] Implement daemon `generateImageCapability()` preserving the existing
      media file metadata response shape
- [x] Add `apps/daemon/src/orchestrator/{tracer.ts, quota.ts}`
      (tracer writes `capability_invocations`, quota is a pass-through stub)
- [x] In `media.ts`, replace direct image-generation path with a shim that
      calls the new capability via the tracer when `db` is provided
- [x] Wire daemon `GET /api/version` to also return `PROTOCOL_VERSION`
- [x] Contract/unit coverage: DB helpers, tracer/quota, image shim, and
      `/api/version` protocol response
- [ ] Manual: trigger a real PPT image generation with configured provider
      credentials; confirm one row lands in `capability_invocations` with
      non-null provider/model/cost metadata

Acceptance: image generation public route/CLI contract preserved;
`pnpm typecheck` green; `pnpm test` green; stub-path image generation
writes `capability_invocations` rows. Real-provider manual validation is
pending credentials/UI execution.

### Phase 2 — first scenario — DONE

- [x] Same extraction for `music-gen`
      (`apps/daemon/src/capabilities/music-gen/index.ts`)
- [x] `media.ts` music shim: `surface=audio, kind≠speech` routes through
      `generateMusicCapability()`; TTS (speech) stays in legacy dispatch
- [x] Create `apps/daemon/src/scenarios/ppt-design/{index.ts,
      prompt-templates.ts, post-process.ts}`
- [x] Implement `Scenario.run()` as an async iterable that calls the
      injected capabilities and yields `ScenarioRunEvent`s
- [x] Add `apps/daemon/src/orchestrator/runner.ts`: SemVer range
      validation (minimal caret-range impl, no semver package); builds
      `CapabilityRegistry` via dynamic imports; provides `DaemonScenarioContext`
      with `writeArtifact()`
- [x] In chat run dispatch, when `skill.od.scenario === 'ppt-design'`,
      route to the new scenario via `runScenarioChatRun()`; otherwise fall
      back to legacy path (shim is dormant until SKILL.md backfill runs)
- [x] Create `scripts/backfill-skill-capabilities.ts` — dry-run by
      default, `--apply` writes changes; infers `capabilities_used` from
      `od.mode`; sets `od.scenario: ppt-design` for deck skills
- [x] Tests: `tests/music-gen-capability.test.ts` + `tests/scenario-runner.test.ts`
- [x] `pnpm --filter @open-design/daemon typecheck` green
- [x] `pnpm --filter @open-design/daemon test` green (339 pass, 5 skipped)

Acceptance: `pnpm typecheck` green; `pnpm test` green; ppt-design scenario
runs end-to-end in stub mode (writes `presentation.html`, logs
`capability_invocations` rows). Backfill script ready to apply; SKILL.md
manual review is a follow-up before activation.

### Phase 3 — split server.ts — DONE

- [x] Move route registrations into `apps/daemon/src/routes/*`
- [x] `server.ts` shrinks to 289-line composition layer (target was < 200; stopped at
      289 because `resolveProjectRoot` + `resolveDaemonResourceRoot` are complex Electron
      path-resolution functions that callers import directly, so they stay in server.ts)
- [x] 14 route modules created: `helpers`, `comment-helpers`, `project-status-helpers`,
      `projects`, `chat`, `media`, `artifacts`, `design-systems`, `templates`, `skills`,
      `codex-pets`, `usage`, `capabilities` (Phase 4 stub), `scenarios` (Phase 4 stub)
- [x] All 6 test files that import from `server.ts` still pass via re-exports
- [x] `pnpm --filter @open-design/daemon typecheck` green
- [x] `pnpm --filter @open-design/daemon test` green (339 pass, 5 skipped)

Acceptance: pure cosmetic refactor; no behavior changes; all tests green.

### Phase 4 — second scenario + UI — DONE

- [x] `frontend-design` scenario via the same shape as ppt-design
      (`apps/daemon/src/scenarios/frontend-design/{index,prompt-templates,post-process}.ts`)
- [x] New routes:
  - `GET /api/v2/capabilities` → list of capability descriptors
    (the `/api/capabilities` URL is already taken by the screenshot
    service from commit `5f17cce`; v2 prefix avoids collision)
  - `GET /api/v2/scenarios` → list of scenario manifests
- [x] Chat dispatch wired for both `ppt-design` and `frontend-design`
      via `scenarioMap` lookup in `routes/chat.ts`
- [x] Web consumes the two endpoints: `fetchCapabilities()` and
      `fetchScenarios()` added to `apps/web/src/providers/registry.ts`;
      contract types added to `packages/contracts/src/api/registry.ts`
- [x] Tests: `frontend-design-scenario.test.ts` (11 tests) +
      `v2-routes.test.ts` (2 tests); all pass
- [x] `pnpm typecheck` green; `pnpm test` green (352 pass, 5 skipped)

Acceptance: `frontend-design` scenario runs end-to-end in stub mode
(writes `design.html`); both v2 endpoints return correct manifests and
descriptors; web API client functions ready for UI consumption. UI
rendering of provider pickers, cost previews, and skill-greying is a
follow-up once UI components are designed.

### Phase 5 — guardrails — DONE

- [x] ESLint `no-restricted-imports` rules enforcing §2's hard rules
      (`eslint.config.mjs`, `pnpm lint:layers`)
- [x] CI step: capability/scenario SemVer equivalent guardrail
      (`scripts/check-capability-semver.ts`, `pnpm check:capability-semver`)
- [x] `docs/capabilities.md` and `docs/scenarios.md`: how to add a new
      capability / scenario, step by step
- [x] CI runs both guardrails before typecheck/test/build
      (`.github/workflows/ci.yml`)

Acceptance: layer violations fail through `pnpm lint:layers`; public
source changes under `packages/capabilities/*` or `packages/scenarios/*`
require a package version bump; contributor docs describe where contracts
and daemon implementations belong.

---

## 9 — Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `media.ts` extraction misses a branch | High | breaks image gen for one user path | Phase 1 keeps shims and runs a 1-week observation window before deletion |
| Skill `capabilities_used` backfill is wrong | Med | UI greys out wrong skills | Field is optional, fallback to `od.mode` inference; backfill is reviewable as a single PR |
| Provider interface designed too early | Med | painful refactor when Tongyi added | First version supports OpenAI + Anthropic only; refactor when third provider lands |
| Forced "generic layout" abstraction | High | wrong shape, technical debt | Spec explicitly defers `layout-gen-*` capabilities — see §12 |
| `server.ts` split causes regressions | Med | broken routes | Phase 3 is its own PR; no scenario / capability work overlaps |
| `.od/app.sqlite` migration fails on user machine | High | data loss | `IF NOT EXISTS` everywhere; future migration runner will auto-backup `.od/app.sqlite.bak.<ts>` before destructive steps |
| Ordering mismatch between `usage_logs` and `capability_invocations` | Low | confused billing | spec §6 makes the relationship explicit (one capability call → 0..N model calls) |
| Scaffold code removed by unrelated cleanup commits | **Happened** | Phase 1 blocked | `4d72773` removed DB tables; Phase 0.6 restores them. Going forward: run `pnpm test` before committing cleanup PRs |

---

## 10 — Commercial hooks (already in place from Phase 0)

These fields exist in the contract from day 1 so future commercialization
does not require a contract break:

| Field | Location | Purpose |
|---|---|---|
| `cost.units` | `CapabilityResult.cost` | Credits-style billing per scenario package |
| `cost.usd` | `CapabilityResult.cost` | External reconciliation / dashboards |
| `quotaToken` | `CapabilityInvocation.options` | Pre-flight quota reservation |
| `provider` | `CapabilityResult.cost` | Per-provider rate cards |
| `cached` | `CapabilityResult` | Cache hits not billed |
| `capability_invocations` table | DB | Single source of truth for usage analytics |

When the product moves to "PPT 版 ¥99/月 含 100 张图" packaging, billing
logic reads only this table — scenarios and capabilities never grow
billing-aware code.

---

## 11 — Known collisions and naming

- `/api/capabilities` is already used by the screenshot service introduced
  in commit `5f17cce` (it returns whether playwright is available).
  Phase 4's new "list registered capability descriptors" endpoint will
  use **`/api/v2/capabilities`** to avoid collision. Rename of the
  screenshot endpoint to `/api/screenshot/capabilities` is left to a
  separate cleanup PR.

---

## 12 — Out of scope (intentionally deferred)

- A "generic `layout-gen` capability". Web layout, slide layout, and
  print layout differ structurally (flex/grid + responsive vs. 16:9
  absolute positioning vs. multi-page A4). Premature unification leads
  to a lowest-common-denominator shape that none of the scenarios
  actually want. Revisit when the third scenario (instruction-manual)
  lands and the actual overlap is observed.
- Plugin marketplace / third-party signing. Needs Phase 5's SemVer
  baseline first.
- Multi-tenant DB / SaaS storage. Current target is Mac/Windows
  desktop; not relevant unless product form changes.
- Linux packaging, Docker images, Kubernetes manifests. Out of scope
  per current product positioning.

---

## 13 — Orchestrator design

The orchestrator (`apps/daemon/src/orchestrator/`) is the runtime glue
between the HTTP layer and the scenario × capability contracts. It is
introduced in Phase 1 and completed in Phase 2.

### 13.1 Runner

`runner.ts` is the single entry point for executing a scenario.

```
caller (route handler)
  │
  ▼
runner.run(scenarioId, input)
  ├─ 1. resolve ScenarioManifest by id
  ├─ 2. build CapabilityRegistry scoped to manifest.capabilities
  │      (SemVer range check: registry rejects capabilities whose
  │       descriptor.version does not satisfy the range in the manifest)
  ├─ 3. pre-flight quota check (QuotaChecker.check for each required cap)
  ├─ 4. call scenario.run(input, ctx)  →  AsyncIterable<ScenarioRunEvent>
  ├─ 5. forward events to caller (SSE or collect)
  └─ 6. on 'done' or error: finalize tracer, release quota hold
```

The runner owns the `ScenarioContext` construction. Scenarios never
build their own context; they receive it fully wired.

### 13.2 Tracer

`tracer.ts` writes `capability_invocations` rows (§6.2).

```ts
interface TraceOutcome {
  readonly status: CapabilityInvocationStatus;
  readonly provider: string;
  readonly costUnits: number;
  readonly costUsd?: number;
  readonly durationMs: number;
  readonly cached: boolean;
  readonly errorMessage?: string;
}
```

The tracer wraps each capability call:

1. `startInvocation()` inserts a row with `status = 'pending'` and
   returns `{ traceId, finish }`.
2. The capability runs.
3. `finish(outcome)` updates the row with final status, cost, and
   duration.

If the process crashes between 1 and 3, the row stays `'pending'`.
A startup sweep (Phase 3+) can mark stale pending rows as `'error'`.

### 13.3 Quota

`quota.ts` starts as a pass-through stub (`check()` always resolves).
When commercial packaging lands, it checks a per-tenant usage limit
against `capability_invocations` totals for the current billing period.

The quota contract is intentionally minimal: one async `check()` that
throws `QuotaExceededError` with `{ scenarioId, capabilityId, limit,
current }`. The runner catches this and emits a `ScenarioRunEvent`
of type `'error'`.

---

## 14 — Error propagation

### Capability-level errors

A capability implementation may:

- **Throw** a provider error (HTTP 429, model refusal, network timeout).
  The orchestrator catches, writes `status = 'error'` to
  `capability_invocations`, and forwards to the scenario as a rejected
  promise.
- **Return** a degraded result (e.g. a fallback image when the primary
  provider fails). This is a `status = 'success'` row; the scenario
  decides whether the degraded output is acceptable.

### Scenario-level errors

A scenario yields `{ type: 'error', message }` for recoverable
problems (e.g. one optional capability failed but the artifact can still
be assembled). It throws for fatal problems (e.g. the only required
capability failed). The runner catches throws and emits a final `error`
event before closing the async iterable.

### Abort / cancellation

`CapabilityInvocationOptions.abortSignal` propagates user cancellation.
When the signal fires:

1. The in-flight provider HTTP request is aborted.
2. The capability returns a rejected promise with an `AbortError`.
3. The tracer writes `status = 'cancelled'`.
4. The runner yields `{ type: 'done' }` (not `'error'`) — cancellation
   is expected, not exceptional.

### Retry policy

Capabilities do **not** retry automatically. The scenario is responsible
for deciding whether to re-invoke a failed capability (e.g. retry
image-gen with a different provider or a simplified prompt). This keeps
retry policy in the product layer, not the infrastructure layer.

---

## 15 — Deferred capability contracts

### 15.1 `voice-gen` — Phase 4

```ts
export type VoiceGenKind = 'tts' | 'clone' | 'narration';

export interface VoiceGenInput {
  readonly text: string;
  readonly kind: VoiceGenKind;
  readonly voiceId?: string;
  readonly language?: string;
  readonly speed?: number;           // 0.5–2.0, default 1.0
}

export interface VoiceGenOutput {
  readonly filePath: string;
  readonly mimeType: 'audio/mpeg' | 'audio/wav' | 'audio/ogg';
  readonly durationSec: number;
  readonly characterCount: number;
}

export type VoiceGenCapability = Capability<VoiceGenInput, VoiceGenOutput>;
```

This is a draft. The contract will be finalized when voice-gen
providers are evaluated. The `MusicGenInput.voiceId` / `.language`
fields were placed on music-gen as an early signal that voice and music
may share provider infrastructure; a future refactor may extract a
shared `AudioGenBase` if the overlap proves real.

### 15.2 `layout-gen-web` and `layout-gen-slide` — deferred

See §12. No contract drafted. The shape depends on which layout
primitives the first three scenarios actually need.

---

## 16 — Testing strategy

### Contract packages (pure TypeScript)

`packages/capabilities/*` and `packages/scenarios/*` are type-only.
Their tests are compile-time: `pnpm typecheck` confirms the contracts
are self-consistent and importable by downstream packages.

### Capability implementations (Phase 1+)

Each `apps/daemon/src/capabilities/<id>/` gets:

- **Unit tests** per provider: mock the provider SDK, assert input
  mapping and output normalization.
- **Cache tests**: given an `input_hash`, assert cache-hit path returns
  `cached: true` without calling the provider.
- **Cost tests**: assert `estimateCost()` returns expected values for
  known inputs.

### Scenario implementations (Phase 2+)

Each `apps/daemon/src/scenarios/<id>/` gets:

- **Integration tests**: inject mock capabilities, run the scenario,
  assert the `ScenarioRunEvent` stream contains expected events in
  order.
- **Prompt snapshot tests**: assert that prompt templates produce
  stable output for fixed inputs (guards against accidental prompt
  regressions).

### Orchestrator (Phase 1+)

- **Runner tests**: mock scenario + capabilities, assert lifecycle
  (quota → run → trace → done).
- **Tracer tests**: assert `capability_invocations` rows are written
  with correct fields.
- **Quota tests**: assert `QuotaExceededError` is thrown when limits
  are hit (once quota is non-stub).

### Boundary enforcement (Phase 5)

ESLint `no-restricted-imports` rules are the compile-time enforcement.
A CI step runs `pnpm lint` and fails if a scenario imports a provider
SDK or a capability imports a scenario.

---

## 17 — Related docs

- `architecture-boundaries.md` — web/daemon/sidecar layering.
- `maintainability-roadmap.md` — orthogonal cleanup track (especially
  W5 "modularize server.ts" which aligns with Phase 3).
- `docs/skills-protocol.md` — the SKILL.md frontmatter spec; will be
  updated alongside Phase 2 for `capabilities_used`.
- `docs/spec.md` — top-level product spec (§4 user scenarios map to
  the scenario contracts defined here).
- `packages/AGENTS.md` — documents the capability and scenario package
  responsibilities and directives for agents working in those packages.
