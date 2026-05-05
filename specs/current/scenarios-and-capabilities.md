# Scenarios × Capabilities Architecture

Status: in progress (Phase 0 scaffolding landed)
Owner: architecture
Last updated: 2026-05-06

This spec describes how the product is layered into **场景包 (scenario
packages)** and **能力 (capabilities)**. It complements
`architecture-boundaries.md` (which fixes web/daemon/sidecar boundaries) by
adding a *vertical × horizontal* product layering inside the daemon.

## 1. Why

The current daemon (`apps/daemon/src/`) is mostly a flat directory:
`server.ts` is ~3.6k lines, `media.ts` ~1.7k, `agents.ts` ~0.85k. As the
product grows from "前端设计 / PPT 设计" into "说明书 / 3D 模型 / 视频" and
the model surface grows from OpenAI + Anthropic into 通义 / 豆包 / 私有
endpoint, this flat layout will not hold.

We split the daemon along two orthogonal axes:

- **Scenario** = vertical slice = product-facing experience.
  Examples: `frontend-design`, `ppt-design`, `instruction-manual` (later),
  `3d-model` (later).
- **Capability** = horizontal building block = reusable atom.
  Examples: `image-gen`, `music-gen`, `voice-gen`, `layout-gen-web`,
  `layout-gen-slide`.

A scenario composes capabilities. A capability never knows which scenario
called it.

## 2. Layering rules

```
┌─────────────────────────────────────────────────────┐
│ apps/web                                            │
│   - UI per scenario, data-driven from /api/*        │
└────────────┬────────────────────────────────────────┘
             │ HTTP / SSE (packages/contracts)
┌────────────▼────────────────────────────────────────┐
│ apps/daemon/src/routes/        (HTTP surface)        │
│ apps/daemon/src/scenarios/<id> (scenario impls)      │
│ apps/daemon/src/orchestrator   (runner / tracer)     │
│ apps/daemon/src/capabilities/<id> (capability impls) │
└────────────┬────────────────────────────────────────┘
             │ provider SDKs (openai, anthropic, ...)
             ▼  external services
```

Hard rules:

- **Scenario impls** must only import: capability interfaces from
  `packages/capabilities/*`, the orchestrator helpers, prompt templates,
  and post-processing helpers local to the scenario.
- **Scenario impls** must NOT import: model SDKs (`openai`,
  `@anthropic-ai/sdk`, etc.), other capabilities' provider files, other
  scenarios' internals, or the daemon's HTTP layer.
- **Capability impls** must only import: provider SDKs they own, the
  daemon DB module (for invocation logging / cache), and capability core.
- **Capability impls** must NOT import: scenarios, prompt templates of
  scenarios, or `server.ts`.
- **`packages/capabilities/*` and `packages/scenarios/*`** are pure
  TypeScript contract packages, just like `packages/contracts`. They must
  not depend on Next.js, Express, Node fs/process APIs, browser APIs, or
  daemon internals.
- These rules will be enforced via ESLint `no-restricted-imports` once the
  first scenario / capability is migrated (Phase 2).

## 3. Capability contract

A capability is described by:

```ts
interface CapabilityDescriptor {
  readonly id: string;          // 'image-gen'
  readonly version: string;     // SemVer for the capability impl
  readonly protocol: number;    // CAPABILITY_PROTOCOL_VERSION
  readonly providers: string[]; // ['openai', 'anthropic', ...]
  readonly cost: CostModel;
}
```

A capability invocation:

```ts
interface CapabilityInvocation<I> {
  readonly runId: string;       // trace key, equal to chat run id
  readonly scenarioId: string;
  readonly input: I;
  readonly options?: { provider?: string; quotaToken?: string;
                       abortSignal?: AbortSignalLike };
}

interface CapabilityResult<O> {
  readonly output: O;
  readonly cost: { provider: string; units: number; usd?: number };
  readonly traceId: string;
  readonly cached: boolean;
}
```

Cost / trace fields are mandatory from day 1. They feed the
`capability_invocations` table (see §6) which is the single source of
truth for per-tenant usage, billing, and debug tracing.

## 4. Scenario contract

A scenario is described by a manifest:

```ts
interface ScenarioManifest {
  readonly id: string;             // 'ppt-design'
  readonly version: string;
  readonly displayName: Record<string, string>; // i18n
  readonly capabilities: CapabilityRequirement[]; // SemVer ranges
  readonly designSystems: { requires: boolean; defaultId?: string };
  readonly modes: ('chat' | 'sketch' | 'spec')[];
}
```

A scenario run is an async iterable of events:

```ts
interface Scenario {
  readonly manifest: ScenarioManifest;
  run(input: ScenarioRunInput,
      ctx: ScenarioContext): AsyncIterable<ScenarioRunEvent>;
}
```

The orchestrator owns the `ScenarioContext`: it injects only the
capabilities the manifest declares, with their versions checked. A
scenario asking for an undeclared capability is a programming error and
fails the run early.

## 5. Skill manifest extension

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

This is the data UI uses to grey out skills whose capabilities are not
satisfied at runtime, and the data the orchestrator uses to estimate cost
before the run starts.

The field is optional during the migration; loaders fall back to
inferring from `od.mode`.

## 6. Database

Two new tables are added in `apps/daemon/src/db.ts` migrate(). Both use
`CREATE TABLE IF NOT EXISTS`, so older `.od/app.sqlite` files upgrade in
place with no manual step.

### 6.1 `schema_version`

```sql
CREATE TABLE IF NOT EXISTS schema_version (
  version    INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
```

The `migrate()` function inserts the current schema version on first
run. Future migration steps will key off this table (full migration
framework lands in a follow-up; the table itself is needed now to make
that follow-up safe).

### 6.2 `capability_invocations`

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
  status        TEXT NOT NULL,
  error_message TEXT,
  cached        INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_capinv_run
  ON capability_invocations(run_id);
CREATE INDEX IF NOT EXISTS idx_capinv_scenario
  ON capability_invocations(scenario_id, created_at);
```

Every capability invocation writes one row. Used for:

- per-run debug trace (UI "show what happened in this run"),
- per-tenant usage / billing (future commercial tier),
- cache lookup (`input_hash`).

## 7. Protocol version

`packages/contracts/src/protocol.ts` exports:

```ts
export const PROTOCOL_VERSION = {
  contracts: 1,
  capabilities: 1,
  scenarios: 1,
} as const;
```

Daemon `GET /api/version` will report this object alongside the existing
`AppVersionInfo`. Web checks contracts version on connect and warns the
user when daemon and web disagree (relevant for auto-update windows).

## 8. Phased rollout

| Phase | Window | What lands |
|---|---|---|
| **0 — scaffold (DONE)** | Week 1 | New empty contract packages; `PROTOCOL_VERSION`; new DB tables. Behavior unchanged. |
| **1 — first capability** | Week 2 | `image-gen` impl extracted from `media.ts`; routes still call old shims; invocations logged. |
| **2 — first scenario** | Week 3 | `music-gen` extracted; `ppt-design` scenario routes through orchestrator; SKILL.md `capabilities_used` filled. |
| **3 — split server.ts** | Week 4 | `apps/daemon/src/routes/*` carved out. No business changes. |
| **4 — second scenario** | Week 5 | `frontend-design` scenario. UI consumes `/api/scenarios` + `/api/capabilities`. |
| **5 — guardrails** | Week 6 | ESLint boundary rules; capability SemVer CI; docs. |

Phase 0 is done by this commit. Phase 1+ are tracked as separate PRs.

## 9. Out of scope (intentionally deferred)

- A "generic layout-gen capability" — premature; revisit when the third
  scenario (instruction-manual) lands and the actual layout overlap is
  observed.
- Plugin marketplace / third-party signing — needs Phase 5's SemVer
  baseline first.
- Multi-tenant DB / SaaS storage — current target is Mac/Windows
  desktop; not relevant until product form changes.

## 10. Related docs

- `architecture-boundaries.md` — web/daemon/sidecar layering.
- `maintainability-roadmap.md` — orthogonal cleanup track.
- `docs/skills-protocol.md` — the SKILL.md frontmatter spec; will be
  updated alongside Phase 2.
