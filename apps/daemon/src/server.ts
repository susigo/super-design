// @ts-nocheck
import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { PROTOCOL_VERSION } from '@open-design/contracts';
import { detectAgents } from './agents.js';
import { createScenarioRunner } from './orchestrator/runner.js';
import { pptDesignScenario } from './scenarios/ppt-design/index.js';
import { createChatRunService } from './runs.js';
import { readCurrentAppVersionInfo } from './app-version.js';
import { openDatabase } from './db.js';
import { createProjectsRouter } from './routes/projects.js';
import { createTemplatesRouter } from './routes/templates.js';
import { createSkillsRouter } from './routes/skills.js';
import { createDesignSystemsRouter } from './routes/design-systems.js';
import { createCodexPetsRouter } from './routes/codex-pets.js';
import { createArtifactsRouter } from './routes/artifacts.js';
import { createMediaRouter } from './routes/media.js';
import { createChatRouter } from './routes/chat.js';
import { createUsageRouter } from './routes/usage.js';
import { createCapabilitiesRouter } from './routes/capabilities.js';
import { createScenariosRouter } from './routes/scenarios.js';
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
} from './routes/comment-helpers.js';
export {
  composeProjectDisplayStatus,
  normalizeProjectDisplayStatus,
} from './routes/project-status-helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resolveProjectRoot(moduleDir) {
  const base = path.basename(moduleDir);
  const daemonDir =
    base === 'dist' || base === 'src' ? path.dirname(moduleDir) : moduleDir;
  return path.resolve(daemonDir, '../..');
}

const PROJECT_ROOT = resolveProjectRoot(__dirname);
const RESOURCE_ROOT_ENV = 'OD_RESOURCE_ROOT';

function isPathWithin(base, target) {
  const relativePath = path.relative(path.resolve(base), path.resolve(target));
  return (
    relativePath === '' ||
    (relativePath.length > 0 &&
      !relativePath.startsWith('..') &&
      !path.isAbsolute(relativePath))
  );
}

function resolveProcessResourcesPath() {
  if (
    typeof process.resourcesPath === 'string' &&
    process.resourcesPath.length > 0
  ) {
    return process.resourcesPath;
  }

  // Packaged daemon sidecars run under the bundled Node binary rather than the
  // Electron root process, so `process.resourcesPath` is unavailable there.
  // Infer the macOS app Resources directory from that bundled Node path.
  const resourcesMarker = `${path.sep}Contents${path.sep}Resources${path.sep}`;
  const markerIndex = process.execPath.indexOf(resourcesMarker);
  if (markerIndex !== -1) {
    return process.execPath.slice(0, markerIndex + resourcesMarker.length - 1);
  }

  const normalizedExecPath = process.execPath.toLowerCase();
  const windowsResourceBinMarker =
    `${path.sep}resources${path.sep}open-design${path.sep}bin${path.sep}`.toLowerCase();
  const windowsMarkerIndex = normalizedExecPath.indexOf(
    windowsResourceBinMarker,
  );
  if (windowsMarkerIndex !== -1) {
    return process.execPath.slice(
      0,
      windowsMarkerIndex + `${path.sep}resources`.length,
    );
  }

  return null;
}

export function resolveDaemonResourceRoot({
  configured = process.env[RESOURCE_ROOT_ENV],
  safeBases = [PROJECT_ROOT, resolveProcessResourcesPath()],
} = {}) {
  if (!configured || configured.length === 0) return null;

  const resolved = path.resolve(configured);
  const normalizedSafeBases = safeBases
    .filter((base) => typeof base === 'string' && base.length > 0)
    .map((base) => path.resolve(base));

  if (!normalizedSafeBases.some((base) => isPathWithin(base, resolved))) {
    throw new Error(
      `${RESOURCE_ROOT_ENV} must be under the workspace root or app resources path`,
    );
  }

  return resolved;
}

function resolveDaemonResourceDir(resourceRoot, segment, fallback) {
  return resourceRoot ? path.join(resourceRoot, segment) : fallback;
}

const DAEMON_RESOURCE_ROOT = resolveDaemonResourceRoot();
// Built web app lives in `out/` — that's where Next.js writes the static
// export configured in next.config.ts. The folder name used to be `dist/`
// when this project shipped with Vite; the daemon serves whatever the
// frontend toolchain emits, no further config needed.
const STATIC_DIR = path.join(PROJECT_ROOT, 'apps', 'web', 'out');
const OD_BIN = path.join(PROJECT_ROOT, 'apps', 'daemon', 'dist', 'cli.js');
const SKILLS_DIR = resolveDaemonResourceDir(
  DAEMON_RESOURCE_ROOT,
  'skills',
  path.join(PROJECT_ROOT, 'skills'),
);
const DESIGN_SYSTEMS_DIR = resolveDaemonResourceDir(
  DAEMON_RESOURCE_ROOT,
  'design-systems',
  path.join(PROJECT_ROOT, 'design-systems'),
);
const CRAFT_DIR = resolveDaemonResourceDir(
  DAEMON_RESOURCE_ROOT,
  'craft',
  path.join(PROJECT_ROOT, 'craft'),
);
const FRAMES_DIR = resolveDaemonResourceDir(
  DAEMON_RESOURCE_ROOT,
  'frames',
  path.join(PROJECT_ROOT, 'assets', 'frames'),
);
const BUNDLED_PETS_DIR = resolveDaemonResourceDir(
  DAEMON_RESOURCE_ROOT,
  'community-pets',
  path.join(PROJECT_ROOT, 'assets', 'community-pets'),
);
const PROMPT_TEMPLATES_DIR = resolveDaemonResourceDir(
  DAEMON_RESOURCE_ROOT,
  'prompt-templates',
  path.join(PROJECT_ROOT, 'prompt-templates'),
);
const RUNTIME_DATA_DIR = process.env.OD_DATA_DIR
  ? path.resolve(PROJECT_ROOT, process.env.OD_DATA_DIR)
  : path.join(PROJECT_ROOT, '.od');
const ARTIFACTS_DIR = path.join(RUNTIME_DATA_DIR, 'artifacts');
const PROJECTS_DIR = path.join(RUNTIME_DATA_DIR, 'projects');
const USER_DESIGN_SYSTEMS_DIR = path.join(RUNTIME_DATA_DIR, 'design-systems');
const DESIGN_SYSTEM_ROOTS = [DESIGN_SYSTEMS_DIR, USER_DESIGN_SYSTEMS_DIR];
const STAGING_DIR = path.join(RUNTIME_DATA_DIR, 'staging', 'design-imports');
fs.mkdirSync(PROJECTS_DIR, { recursive: true });
fs.mkdirSync(USER_DESIGN_SYSTEMS_DIR, { recursive: true });
fs.mkdirSync(STAGING_DIR, { recursive: true });

export async function startServer({ port = 7456, host = process.env.OD_BIND_HOST || '0.0.0.0', returnServer = false } = {}) {
  let resolvedPort = port;
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  const db = openDatabase(PROJECT_ROOT, { dataDir: RUNTIME_DATA_DIR });

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

  const design = {
    runs: createChatRunService({ createSseResponse, createSseErrorPayload }),
  };

  // ── Scenario runner (Phase 2) ──────────────────────────────────────────
  const scenarioRunner = createScenarioRunner(db);

  const ctx = {
    db,
    port: resolvedPort,
    projectRoot: PROJECT_ROOT,
    projectsDir: PROJECTS_DIR,
    skillsDir: SKILLS_DIR,
    designSystemRoots: DESIGN_SYSTEM_ROOTS,
    userDesignSystemsDir: USER_DESIGN_SYSTEMS_DIR,
    stagingDir: STAGING_DIR,
    artifactsDir: ARTIFACTS_DIR,
    framesDir: FRAMES_DIR,
    bundledPetsDir: BUNDLED_PETS_DIR,
    promptTemplatesDir: PROMPT_TEMPLATES_DIR,
    craftDir: CRAFT_DIR,
    odBin: OD_BIN,
    runtimeDataDir: RUNTIME_DATA_DIR,
    design,
    scenarioRunner,
    pptDesignScenario,
  };

  app.use('/api', createProjectsRouter(ctx));
  app.use('/api', createTemplatesRouter(ctx));
  app.use('/api', createSkillsRouter(ctx));
  app.use('/api', createDesignSystemsRouter(ctx));
  app.use('/api', createCodexPetsRouter(ctx));
  app.use('/api', createArtifactsRouter(ctx));
  app.use('/api', createMediaRouter(ctx));
  app.use('/api', createChatRouter(ctx));
  app.use('/api', createUsageRouter(ctx));
  app.use('/api', createCapabilitiesRouter(ctx));
  app.use('/api', createScenariosRouter(ctx));

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
