# Capabilities

Capabilities are horizontal contract packages under `packages/capabilities/*`. They define reusable input, output, cost, and invocation types only; daemon implementations live under `apps/daemon/src/capabilities/<id>/`.

## Add a capability

1. Create `packages/capabilities/<id>/` with `package.json`, `tsconfig.json`, and `src/index.ts`.
2. Depend on `@open-design/capabilities-core` for shared `Capability` types.
3. Export only pure TypeScript contract types from `src/index.ts`.
4. Add the daemon implementation under `apps/daemon/src/capabilities/<id>/` and register it in the orchestrator registry.
5. Add or update scenario manifests that require the capability with a SemVer range.
6. Run `pnpm --filter '@open-design/capabilities-*' typecheck`, `pnpm lint:layers`, and `pnpm check:capability-semver`.

Capability packages must not import apps, scenarios, provider SDKs, Express, Electron, Node filesystem/process APIs, SQLite, or sidecar packages. Provider SDKs and runtime I/O belong in the daemon implementation, not the contract package.
