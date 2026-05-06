import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RESOURCE_ROOT_ENV = 'OD_RESOURCE_ROOT';

export function resolveProjectRoot(moduleDir: string): string {
  const base = path.basename(moduleDir);
  const daemonDir =
    base === 'dist' || base === 'src' ? path.dirname(moduleDir) : moduleDir;
  return path.resolve(daemonDir, '../..');
}

export const PROJECT_ROOT = resolveProjectRoot(__dirname);

function isPathWithin(base: string, target: string): boolean {
  const relativePath = path.relative(path.resolve(base), path.resolve(target));
  return (
    relativePath === '' ||
    (relativePath.length > 0 &&
      !relativePath.startsWith('..') &&
      !path.isAbsolute(relativePath))
  );
}

function resolveProcessResourcesPath(): string | null {
  const resourcesPath = (
    process as NodeJS.Process & { readonly resourcesPath?: string }
  ).resourcesPath;
  if (typeof resourcesPath === 'string' && resourcesPath.length > 0) {
    return resourcesPath;
  }

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
}: {
  readonly configured?: string;
  readonly safeBases?: readonly (string | null)[];
} = {}): string | null {
  if (!configured || configured.length === 0) return null;

  const resolved = path.resolve(configured);
  const normalizedSafeBases = safeBases
    .filter((base): base is string => typeof base === 'string' && base.length > 0)
    .map((base) => path.resolve(base));

  if (!normalizedSafeBases.some((base) => isPathWithin(base, resolved))) {
    throw new Error(
      `${RESOURCE_ROOT_ENV} must be under the workspace root or app resources path`,
    );
  }

  return resolved;
}

export function resolveDaemonResourceDir(
  resourceRoot: string | null,
  segment: string,
  fallback: string,
): string {
  return resourceRoot ? path.join(resourceRoot, segment) : fallback;
}

export const DAEMON_RESOURCE_ROOT = resolveDaemonResourceRoot();
export const STATIC_DIR = path.join(PROJECT_ROOT, 'apps', 'web', 'out');
export const OD_BIN = path.join(PROJECT_ROOT, 'apps', 'daemon', 'dist', 'cli.js');
export const SKILLS_DIR = resolveDaemonResourceDir(
  DAEMON_RESOURCE_ROOT,
  'skills',
  path.join(PROJECT_ROOT, 'skills'),
);
export const DESIGN_SYSTEMS_DIR = resolveDaemonResourceDir(
  DAEMON_RESOURCE_ROOT,
  'design-systems',
  path.join(PROJECT_ROOT, 'design-systems'),
);
export const CRAFT_DIR = resolveDaemonResourceDir(
  DAEMON_RESOURCE_ROOT,
  'craft',
  path.join(PROJECT_ROOT, 'craft'),
);
export const FRAMES_DIR = resolveDaemonResourceDir(
  DAEMON_RESOURCE_ROOT,
  'frames',
  path.join(PROJECT_ROOT, 'assets', 'frames'),
);
export const BUNDLED_PETS_DIR = resolveDaemonResourceDir(
  DAEMON_RESOURCE_ROOT,
  'community-pets',
  path.join(PROJECT_ROOT, 'assets', 'community-pets'),
);
export const PROMPT_TEMPLATES_DIR = resolveDaemonResourceDir(
  DAEMON_RESOURCE_ROOT,
  'prompt-templates',
  path.join(PROJECT_ROOT, 'prompt-templates'),
);
export const RUNTIME_DATA_DIR = process.env.OD_DATA_DIR
  ? path.resolve(PROJECT_ROOT, process.env.OD_DATA_DIR)
  : path.join(PROJECT_ROOT, '.od');
export const ARTIFACTS_DIR = path.join(RUNTIME_DATA_DIR, 'artifacts');
export const PROJECTS_DIR = path.join(RUNTIME_DATA_DIR, 'projects');
export const USER_DESIGN_SYSTEMS_DIR = path.join(
  RUNTIME_DATA_DIR,
  'design-systems',
);
export const DESIGN_SYSTEM_ROOTS = [
  DESIGN_SYSTEMS_DIR,
  USER_DESIGN_SYSTEMS_DIR,
] as const;
export const STAGING_DIR = path.join(
  RUNTIME_DATA_DIR,
  'staging',
  'design-imports',
);

export function ensureDaemonRuntimeDirs(): void {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  fs.mkdirSync(USER_DESIGN_SYSTEMS_DIR, { recursive: true });
  fs.mkdirSync(STAGING_DIR, { recursive: true });
}
