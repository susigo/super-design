# Scenarios × Capabilities Architecture

| Field | Value |
|---|---|
| Status | Phase 0 ✅ landed (commit `51e5ae7`) · Phase 1 ⏳ next |
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
│   ├── layout-gen-web/              [deferred — see §13]
│   └── layout-gen-slide/            [deferred — see §13]
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
| **0 — scaffold** | Week 1 | ✅ **DONE** (commit `51e5ae7`) | Empty contract packages, `PROTOCOL_VERSION`, two new DB tables. Behavior unchanged. |
| **0.5 — fix daemon typecheck baseline** | inserted | ⏳ NEXT | Pre-existing baseline failures in `screenshot.ts` (commit `5f17cce`) and contracts ESM extensions block any further daemon work. |
| **1 — first capability** | Week 2 | ⏳ pending | `image-gen` impl extracted from `media.ts`; old shims still serve callers; invocations logged. |
| **2 — first scenario** | Week 3 | ⏳ pending | `music-gen` extracted; `ppt-design` scenario routes through orchestrator; SKILL.md `capabilities_used` filled. |
| **3 — split server.ts** | Week 4 | ⏳ pending | `apps/daemon/src/routes/*` carved out. No business changes. |
| **4 — second scenario** | Week 5 | ⏳ pending | `frontend-design` scenario. UI consumes `/api/v2/scenarios` + `/api/v2/capabilities`. |
| **5 — guardrails** | Week 6 | ⏳ pending | ESLint boundary rules; capability SemVer CI; docs update. |

Phase 0 is behavior-neutral; Phases 1–4 progressively replace flat
files with the new layout while keeping callers working through shims.

### Phase 0 — DONE

Acceptance: ✅ all met.

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

### Phase 0.5 — fix daemon typecheck baseline (NEXT)

The previous user commit `5f17cce` left the daemon typecheck failing on
`main`. This must be cleaned up before Phase 1 so we have a green gate
for incremental work.

- [ ] Identify whether `ScreenshotEntry` / `ScreenshotViewport` are
      defined in `packages/contracts/src/api/artifacts.ts` but not
      re-exported from `index.ts`, and add the missing export(s).
- [ ] Decide playwright import shape: either declare it as an optional
      runtime dep (lazy `await import('playwright')`) with proper types,
      or add `playwright` to `apps/daemon/package.json` devDependencies.
- [ ] Confirm contracts ESM extension errors in daemon's tsconfig are
      pre-existing or caused by 5f17cce; fix at the daemon tsconfig
      level (not in contracts) since contracts must stay extension-free
      for its own pure-TS source export.
- [ ] `pnpm --filter @open-design/daemon typecheck` green.
- [ ] `pnpm typecheck` (root) green.

### Phase 1 — image-gen capability (after 0.5)

- [ ] Create `apps/daemon/src/capabilities/image-gen/{index.ts,
      providers/openai.ts, providers/anthropic.ts, cache.ts}`
- [ ] Move OpenAI / Anthropic image-generation paths from
      `media.ts` into the provider files (no behavior change)
- [ ] Implement `ImageGenCapability` returning `CapabilityResult`
- [ ] Add `apps/daemon/src/orchestrator/{tracer.ts, quota.ts}`
      (minimal versions: tracer writes `capability_invocations`,
      quota is a pass-through stub)
- [ ] In `media.ts`, replace direct image-generation bodies with
      shims that call the new capability via the tracer
- [ ] Wire daemon `GET /api/version` to also return `PROTOCOL_VERSION`
- [ ] Contract test: existing image-generation API responses unchanged
- [ ] Manual: trigger a real PPT image generation; confirm one row
      lands in `capability_invocations` with non-null `cost_units`

Acceptance: image generation behavior bit-identical; `pnpm typecheck`
green; `pnpm test` green; capability_invocations rows present.

### Phase 2 — first scenario

- [ ] Same extraction for `music-gen`
- [ ] Create `apps/daemon/src/scenarios/ppt-design/{index.ts,
      prompt-templates.ts, post-process.ts}`
- [ ] Implement `Scenario.run()` as an async iterable that calls the
      injected capabilities and yields `ScenarioRunEvent`s
- [ ] Add `apps/daemon/src/orchestrator/runner.ts`: takes a scenario
      manifest + capability registry, validates SemVer ranges, runs
      the scenario
- [ ] In chat run dispatch, when `skill.od.scenario === 'ppt-design'`,
      route to the new scenario; otherwise fall back to legacy path
- [ ] Backfill SKILL.md `capabilities_used` for all 48 skills
      (script + manual review)

### Phase 3 — split server.ts

- [ ] Move route registrations into `apps/daemon/src/routes/*`
- [ ] `server.ts` shrinks to app/middleware composition only

This phase is cosmetic and should not run in parallel with Phase 1/2
to avoid merge conflicts.

### Phase 4 — second scenario + UI

- [ ] `frontend-design` scenario via the same shape as ppt-design
- [ ] New routes:
  - `GET /api/v2/capabilities` → list of capability descriptors
    (the `/api/capabilities` URL is already taken by the screenshot
    service from commit `5f17cce`; v2 prefix avoids collision)
  - `GET /api/v2/scenarios` → list of scenario manifests
- [ ] Web consumes the two endpoints; renders provider pickers, cost
      previews, and skill-greying based on `capabilities_used`

### Phase 5 — guardrails

- [ ] ESLint `no-restricted-imports` rules enforcing §2's hard rules
- [ ] CI step: `@arethetypeswrong/cli` (or equivalent) on capability
      packages to catch breaking SemVer changes early
- [ ] `docs/capabilities.md` and `docs/scenarios.md`: how to add a new
      capability / scenario, step by step

---

## 9 — Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `media.ts` extraction misses a branch | High | breaks image gen for one user path | Phase 1 keeps shims and runs a 1-week observation window before deletion |
| Skill `capabilities_used` backfill is wrong | Med | UI greys out wrong skills | Field is optional, fallback to `od.mode` inference; backfill is reviewable as a single PR |
| Provider interface designed too early | Med | painful refactor when Tongyi added | First version supports OpenAI + Anthropic only; refactor when third provider lands |
| Forced "generic layout" abstraction | High | wrong shape, technical debt | Spec explicitly defers `layout-gen-*` capabilities — see §13 |
| `server.ts` split causes regressions | Med | broken routes | Phase 3 is its own PR; no scenario / capability work overlaps |
| `.od/app.sqlite` migration fails on user machine | High | data loss | `IF NOT EXISTS` everywhere; future migration runner will auto-backup `.od/app.sqlite.bak.<ts>` before destructive steps |
| Ordering mismatch between `usage_logs` and `capability_invocations` | Low | confused billing | spec §6 makes the relationship explicit (one capability call → 0..N model calls) |

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

## 13 — Related docs

- `architecture-boundaries.md` — web/daemon/sidecar layering.
- `maintainability-roadmap.md` — orthogonal cleanup track.
- `docs/skills-protocol.md` — the SKILL.md frontmatter spec; will be
  updated alongside Phase 2.
- `docs/spec.md` — top-level product spec.
