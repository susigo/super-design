# packages/AGENTS.md

Follow the root `AGENTS.md` first. This file only records module-level boundaries for `packages/`.

## Package responsibilities

- `packages/contracts`: web/daemon app contract layer. Keep it pure TypeScript; it must not depend on Next.js, Express, Node filesystem/process APIs, browser APIs, SQLite, daemon internals, or the sidecar control-plane protocol.
- `packages/sidecar-proto`: Open Design sidecar business protocol. Owns app/mode/source constants, namespace validation, stamp descriptor/fields/flags, IPC message schema, status shapes, error semantics, and default product path constants.
- `packages/sidecar`: generic sidecar runtime primitives. Includes bootstrap, IPC transport, path/runtime resolution, launch env, and JSON runtime file helpers; it must not hard-code Open Design app keys or IPC business messages.
- `packages/platform`: generic OS process primitives. Includes stamp serialization, command parsing, and process matching/search; it must consume the `sidecar-proto` descriptor and must not hard-code `--od-stamp-*` details.
- `packages/capabilities/*`: pure-TypeScript contracts for horizontal capabilities (image-gen, music-gen, ...). Each capability package owns input/output/cost types only; implementations live in `apps/daemon/src/capabilities/<id>/`. See `specs/current/scenarios-and-capabilities.md`.
- `packages/scenarios/*`: pure-TypeScript contracts and manifests for vertical scenario packages (frontend-design, ppt-design, ...). Each scenario package declares which capabilities it depends on via SemVer ranges; implementations live in `apps/daemon/src/scenarios/<id>/`.

## Removed directories

- `packages/shared` has been removed; do not restore it.
- For new shared types, choose the boundary first: web/daemon app DTOs go in `contracts`; sidecar control-plane protocol goes in `sidecar-proto`; generic runtime code goes in `sidecar`; generic OS/process code goes in `platform`.

## Boundary checklist

- Do not move runtime validation/schema enforcement into `contracts` prematurely; current contracts define the typed target shape only.
- Do not let app packages depend directly on sidecar control-plane details.
- Do not hard-code Open Design app/source/mode constants in `sidecar` or `platform`.
- Keep stamp fields limited to five: `app`, `mode`, `namespace`, `ipc`, and `source`.

## Common package commands

```bash
pnpm --filter @open-design/contracts typecheck
pnpm --filter @open-design/sidecar-proto typecheck
pnpm --filter @open-design/sidecar-proto test
pnpm --filter @open-design/sidecar typecheck
pnpm --filter @open-design/sidecar test
pnpm --filter @open-design/platform typecheck
pnpm --filter @open-design/platform test
pnpm --filter '@open-design/capabilities-*' typecheck
pnpm --filter '@open-design/scenarios-*' typecheck
```
