/**
 * Protocol versions for the layered contracts.
 *
 * - `contracts`: HTTP/SSE shapes between web and daemon (this package).
 * - `capabilities`: capability invocation shape (`@open-design/capabilities-core`).
 * - `scenarios`: scenario run/event shape (`@open-design/scenarios-core`).
 *
 * Bumped on incompatible changes. Daemon reports the live triple via
 * `GET /api/version`; web compares it to its own compile-time copy and
 * surfaces an upgrade hint when they disagree (relevant for
 * auto-update windows where one side is newer than the other).
 */
export const PROTOCOL_VERSION = {
  contracts: 1,
  capabilities: 1,
  scenarios: 1,
} as const;

export type ProtocolVersion = typeof PROTOCOL_VERSION;
