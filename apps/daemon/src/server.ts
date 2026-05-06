// @ts-nocheck
import express from 'express';
import fs from 'node:fs';
import { PROTOCOL_VERSION } from '@open-design/contracts';
import { detectAgents } from './agents/index.js';
import { readCurrentAppVersionInfo } from './app-version.js';
import { createDaemonAppContext } from './app-context.js';
import { FRAMES_DIR, STATIC_DIR } from './resources.js';
import { registerApiRoutes } from './routes/index.js';
import { createSseResponse, createSseErrorPayload } from './routes/helpers.js';

// Re-export for test compatibility
export {
  createCompatApiError,
  createCompatApiErrorResponse,
  createSseResponse,
  createSseErrorPayload,
  SSE_KEEPALIVE_INTERVAL_MS,
  isLocalSameOrigin,
} from './routes/helpers.js';
export {
  normalizeCommentAttachments,
  renderCommentAttachmentHint,
} from './project-status/comment-helpers.js';
export {
  composeProjectDisplayStatus,
  normalizeProjectDisplayStatus,
} from './project-status/helpers.js';

export { resolveProjectRoot, resolveDaemonResourceRoot } from './resources.js';

export async function startServer({ port = 7456, host = process.env.OD_BIND_HOST || '0.0.0.0', returnServer = false } = {}) {
  let resolvedPort = port;
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  if (process.env.OD_CODEX_DISABLE_PLUGINS === '1') {
    console.log('[od] Codex plugins disabled via OD_CODEX_DISABLE_PLUGINS=1');
  }

  // Warm agent-capability probes (e.g. whether the installed Claude Code
  // build advertises --include-partial-messages) so the first /api/chat
  // hits a populated cache even if /api/agents hasn't been called yet.
  void detectAgents().catch(() => {});

  if (fs.existsSync(STATIC_DIR)) {
    app.use(express.static(STATIC_DIR));
  }

  app.get('/api/health', async (_req, res) => {
    const versionInfo = await readCurrentAppVersionInfo();
    res.json({ ok: true, version: versionInfo.version });
  });

  app.get('/api/version', async (_req, res) => {
    const version = await readCurrentAppVersionInfo();
    res.json({ version, protocolVersion: PROTOCOL_VERSION });
  });

  // Shared device frames (iPhone, Android, iPad, MacBook, browser chrome).
  // Skills can compose multi-screen / multi-device layouts by pointing at
  // these files via `<iframe src="/frames/iphone-15-pro.html?screen=...">`.
  // No mtime-based caching — frames are static and small.
  app.use('/frames', express.static(FRAMES_DIR));

  const ctx = createDaemonAppContext({ port: resolvedPort });
  registerApiRoutes(app, ctx);

  // Wait for `listen` to bind so callers always see the resolved URL —
  // critical when port=0 (ephemeral port) and when the embedding sidecar
  // needs to advertise the port to a parent process before any request
  // can flow. Three callers depend on this contract:
  //   - `apps/daemon/src/cli.ts`            → expects a `url` string
  //   - `apps/daemon/sidecar/server.ts`     → expects `{ url, server }`
  //   - `apps/daemon/tests/version-route.test.ts` → expects `{ url, server }`
  return await new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const address = server.address();
      // `address()` can in theory return `string | AddressInfo | null`. For
      // a TCP listener it's always `AddressInfo` with a `.port` — the guard
      // is belt-and-braces so an unexpected null never silently produces a
      // `http://127.0.0.1:0` URL that callers would then try to fetch.
      const boundPort =
        address && typeof address === 'object' ? address.port : null;
      if (!boundPort) {
        reject(
          new Error(
            `[od] daemon failed to resolve listening port (address=${JSON.stringify(address)})`,
          ),
        );
        return;
      }
      resolvedPort = boundPort;
      // When binding to all interfaces report localhost for local callers;
      // when binding to a specific address (e.g. a Tailscale IP) report that
      // address so remote callers and the sidecar use the correct URL.
      const reportHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
      const url = `http://${reportHost}:${resolvedPort}`;
      if (!returnServer) {
        console.log(`[od] daemon listening on ${url}`);
      }
      resolve(returnServer ? { url, server } : url);
    });
    // `app.listen` throws synchronously when the port is already in use on
    // some Node versions, but emits an `error` event on others (and for
    // EACCES / EADDRNOTAVAIL even on the same Node). Wire the event so the
    // returned Promise always settles instead of hanging forever.
    server.on('error', reject);
  });
}
