# Scenarios

Scenarios are vertical contract packages under `packages/scenarios/*`. They publish manifests and scenario-facing contract types; daemon implementations live under `apps/daemon/src/scenarios/<id>/`.

## Add a scenario

1. Create `packages/scenarios/<id>/` with `package.json`, `tsconfig.json`, and `src/index.ts`.
2. Depend on `@open-design/scenarios-core` for `ScenarioManifest` and related types.
3. Declare required and optional capabilities with SemVer ranges in the manifest.
4. Add the daemon implementation under `apps/daemon/src/scenarios/<id>/` with local prompt templates and post-processing helpers.
5. Register the scenario in daemon chat dispatch and expose it through `/api/v2/scenarios`.
6. Update web labels or picker behavior if the new scenario is user-visible.
7. Run `pnpm --filter '@open-design/scenarios-*' typecheck`, `pnpm lint:layers`, and `pnpm check:capability-semver`.

Scenario packages must not import apps, capability implementations, provider SDKs, Express, Electron, Node filesystem/process APIs, SQLite, or sidecar packages. Runtime work belongs in `apps/daemon/src/scenarios/<id>/`; the package stays as the pure contract and manifest surface.
