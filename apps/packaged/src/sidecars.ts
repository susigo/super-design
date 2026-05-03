import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, open, type FileHandle } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import {
  APP_KEYS,
  OPEN_DESIGN_SIDECAR_CONTRACT,
  SIDECAR_ENV,
  SIDECAR_MESSAGES,
  SIDECAR_MODES,
  type AppKey,
  type DaemonStatusSnapshot,
  type SidecarStamp,
  type WebStatusSnapshot,
} from "@open-design/sidecar-proto";
import {
  createSidecarLaunchEnv,
  requestJsonIpc,
  resolveAppIpcPath,
  type SidecarRuntimeContext,
} from "@open-design/sidecar";
import { createProcessStampArgs, stopProcesses, waitForProcessExit } from "@open-design/platform";

import type { PackagedNamespacePaths } from "./paths.js";

const require = createRequire(import.meta.url);
const CLAUDE_GIT_BASH_ENV = "CLAUDE_CODE_GIT_BASH_PATH";
const PACKAGED_CHILD_ENV_ALLOWLIST = ["HOME", "LANG", "LC_ALL", "LOGNAME", "TMPDIR", "USER"] as const;
const PACKAGED_CHILD_WINDOWS_ENV_ALLOWLIST = [
  "ALLUSERSPROFILE",
  "APPDATA",
  "CommonProgramFiles",
  "CommonProgramFiles(x86)",
  "ComSpec",
  "COMSPEC",
  "HOMEDRIVE",
  "HOMEPATH",
  "LOCALAPPDATA",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_ARCHITEW6432",
  "ProgramData",
  "PROGRAMDATA",
  "ProgramFiles",
  "PROGRAMFILES",
  "ProgramFiles(x86)",
  "SystemRoot",
  "TEMP",
  "TMP",
  "USERDOMAIN",
  "USERNAME",
  "USERPROFILE",
  "WINDIR",
  CLAUDE_GIT_BASH_ENV,
] as const;

type GitBashResolution = {
  bashPath: string;
  pathEntries: string[];
};

export type PackagedSidecarHandle = {
  close(): Promise<void>;
  daemon: DaemonStatusSnapshot;
  web: WebStatusSnapshot;
};

type ManagedSidecarChild = {
  app: AppKey;
  child: ChildProcess;
  ipcPath: string;
  logHandle: FileHandle;
};

type PackagedDaemonManagedPathEnv = {
  OD_DATA_DIR: string;
  OD_RESOURCE_ROOT: string;
};

function resolveSidecarEntry(packageName: string, exportName: string): string {
  return require.resolve(`${packageName}/${exportName}`);
}

function logPathFor(paths: PackagedNamespacePaths, app: AppKey): string {
  return join(paths.logsRoot, app, "latest.log");
}

async function openLog(path: string): Promise<FileHandle> {
  await mkdir(dirname(path), { recursive: true });
  return await open(path, "w");
}

async function waitForStatus<T>(
  ipcPath: string,
  isReady: (status: T) => boolean,
  timeoutMs = 35_000,
): Promise<T> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const status = await requestJsonIpc<T>(
        ipcPath,
        { type: SIDECAR_MESSAGES.STATUS },
        { timeoutMs: 800 },
      );
      if (isReady(status)) return status;
    } catch (error) {
      lastError = error;
    }
    await sleep(150);
  }

  throw new Error(
    `timed out waiting for sidecar status at ${ipcPath}${
      lastError instanceof Error ? ` (${lastError.message})` : ""
    }`,
  );
}

function extractPort(url: string): string {
  const parsed = new URL(url);
  return parsed.port || (parsed.protocol === "https:" ? "443" : "80");
}

function readEnvCaseInsensitive(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  if (value != null) return value;
  const normalizedKey = key.toLowerCase();
  const matchingKey = Object.keys(env).find((entry) => entry.toLowerCase() === normalizedKey);
  return matchingKey == null ? undefined : env[matchingKey];
}

function existingDirsUnder(root: string, segments: string[] = []): string[] {
  const dirs: string[] = [];
  try {
    const entries = readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = join(root, entry.name, ...segments);
      if (existsSync(full)) dirs.push(full);
    }
  } catch {
    // best-effort: directory may not exist or be unreadable
  }
  return dirs;
}

function collectNvmFnmBins(home: string): string[] {
  return [
    ...existingDirsUnder(join(home, ".nvm", "versions", "node"), ["bin"]),
    ...existingDirsUnder(join(home, ".local", "share", "fnm", "node-versions"), ["installation", "bin"]),
    ...existingDirsUnder(join(home, ".local", "share", "mise", "installs", "node"), ["bin"]),
  ];
}

function existingDirectoryEntries(entries: readonly string[]): string[] {
  return entries.filter((entry) => entry.length > 0 && existsSync(entry));
}

function gitPathEntries(gitRoot: string): string[] {
  return existingDirectoryEntries([
    join(gitRoot, "cmd"),
    join(gitRoot, "bin"),
    join(gitRoot, "usr", "bin"),
    join(gitRoot, "mingw64", "bin"),
  ]);
}

function gitRootFromBashPath(bashPath: string): string | null {
  const normalized = bashPath.replace(/\\/g, "/").toLowerCase();
  if (normalized.endsWith("/bin/bash.exe")) return dirname(dirname(bashPath));
  if (normalized.endsWith("/usr/bin/bash.exe")) return dirname(dirname(dirname(bashPath)));
  return null;
}

function gitBashFromRoot(gitRoot: string): GitBashResolution | null {
  const bashCandidates = [join(gitRoot, "bin", "bash.exe"), join(gitRoot, "usr", "bin", "bash.exe")];
  const bashPath = bashCandidates.find((candidate) => existsSync(candidate));
  if (bashPath == null) return null;
  return { bashPath, pathEntries: gitPathEntries(gitRoot) };
}

function resolveGitBashFromPath(pathValue: string): GitBashResolution | null {
  for (const entry of pathValue.split(delimiter)) {
    if (entry.length === 0) continue;
    const bashPath = join(entry, "bash.exe");
    if (!existsSync(bashPath)) continue;
    const gitRoot = gitRootFromBashPath(bashPath);
    return { bashPath, pathEntries: gitRoot == null ? [entry] : gitPathEntries(gitRoot) };
  }
  return null;
}

function commonWindowsGitRoots(env: NodeJS.ProcessEnv): string[] {
  return [
    readEnvCaseInsensitive(env, "ProgramFiles") == null
      ? undefined
      : join(readEnvCaseInsensitive(env, "ProgramFiles") as string, "Git"),
    readEnvCaseInsensitive(env, "ProgramFiles(x86)") == null
      ? undefined
      : join(readEnvCaseInsensitive(env, "ProgramFiles(x86)") as string, "Git"),
    readEnvCaseInsensitive(env, "LOCALAPPDATA") == null
      ? undefined
      : join(readEnvCaseInsensitive(env, "LOCALAPPDATA") as string, "Programs", "Git"),
    readEnvCaseInsensitive(env, "USERPROFILE") == null
      ? undefined
      : join(readEnvCaseInsensitive(env, "USERPROFILE") as string, "scoop", "apps", "git", "current"),
  ].filter((entry): entry is string => entry != null && entry.length > 0);
}

function resolveSystemGitBash(env: NodeJS.ProcessEnv, pathValue: string): GitBashResolution | null {
  return (
    resolveGitBashFromPath(pathValue) ??
    commonWindowsGitRoots(env)
      .map((gitRoot) => gitBashFromRoot(gitRoot))
      .find((resolution): resolution is GitBashResolution => resolution != null) ??
    null
  );
}

function resolveBundledGitBash(resourceRoot: string): GitBashResolution | null {
  return gitBashFromRoot(join(resourceRoot, "git"));
}

function resolvePackagedPathEnv(basePath: string, extraEntries: readonly string[] = []): string {
  const home = homedir();
  const candidates = process.platform === "win32"
    ? [...extraEntries, ...basePath.split(delimiter)]
    : [
        ...basePath.split(delimiter),
        join(home, ".local", "bin"),
        join(home, ".opencode", "bin"),
        join(home, ".cargo", "bin"),
        join(home, ".bun", "bin"),
        join(home, ".volta", "bin"),
        ...collectNvmFnmBins(home),
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
      ];
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const entry of candidates) {
    if (entry.length === 0) continue;
    const key = process.platform === "win32" ? entry.toLowerCase() : entry;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  return entries.join(delimiter);
}

function resolvePackagedChildBaseEnv(
  paths: PackagedNamespacePaths,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const baseEnv: NodeJS.ProcessEnv = {};
  for (const key of PACKAGED_CHILD_ENV_ALLOWLIST) {
    const value = env[key];
    if (value != null && value.length > 0) baseEnv[key] = value;
  }

  const basePath = readEnvCaseInsensitive(env, "PATH") ?? "";
  const userGitBashPath = readEnvCaseInsensitive(env, CLAUDE_GIT_BASH_ENV);
  let extraPathEntries: string[] = [];

  if (process.platform === "win32") {
    for (const key of PACKAGED_CHILD_WINDOWS_ENV_ALLOWLIST) {
      const value = readEnvCaseInsensitive(env, key);
      if (value != null && value.length > 0) baseEnv[key] = value;
    }

    if (userGitBashPath == null || userGitBashPath.length === 0) {
      const gitBash = resolveSystemGitBash(env, basePath) ?? resolveBundledGitBash(paths.resourceRoot);
      if (gitBash != null) {
        baseEnv[CLAUDE_GIT_BASH_ENV] = gitBash.bashPath;
        extraPathEntries = gitBash.pathEntries;
      }
    }
  }

  baseEnv.PATH = resolvePackagedPathEnv(basePath, extraPathEntries);
  return baseEnv;
}

function createPackagedDaemonManagedPathEnv(
  paths: PackagedNamespacePaths,
): PackagedDaemonManagedPathEnv {
  return {
    OD_DATA_DIR: paths.dataRoot,
    OD_RESOURCE_ROOT: paths.resourceRoot,
  };
}

async function spawnSidecarChild(options: {
  app: AppKey;
  entryPath: string;
  env: NodeJS.ProcessEnv;
  nodeCommand: string | null;
  paths: PackagedNamespacePaths;
  runtime: SidecarRuntimeContext<SidecarStamp>;
}): Promise<ManagedSidecarChild> {
  const ipcPath = resolveAppIpcPath({
    app: options.app,
    contract: OPEN_DESIGN_SIDECAR_CONTRACT,
    namespace: options.runtime.namespace,
  });
  const stamp = {
    app: options.app,
    ipc: ipcPath,
    mode: SIDECAR_MODES.RUNTIME,
    namespace: options.runtime.namespace,
    source: options.runtime.source,
  } satisfies SidecarStamp;
  const logHandle = await openLog(logPathFor(options.paths, options.app));
  const childEnv = createSidecarLaunchEnv({
    base: options.paths.runtimeRoot,
    contract: OPEN_DESIGN_SIDECAR_CONTRACT,
    extraEnv: {
      ...resolvePackagedChildBaseEnv(options.paths),
      ...options.env,
      NODE_ENV: "production",
      ...(options.nodeCommand == null ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    },
    stamp,
  });
  const command = options.nodeCommand ?? process.execPath;
  const child = spawn(
    command,
    [options.entryPath, ...createProcessStampArgs(stamp, OPEN_DESIGN_SIDECAR_CONTRACT)],
    {
      cwd: process.cwd(),
      env: childEnv,
      stdio: ["ignore", logHandle.fd, logHandle.fd],
      windowsHide: true,
    },
  );

  await new Promise<void>((resolveSpawn, rejectSpawn) => {
    child.once("error", rejectSpawn);
    child.once("spawn", resolveSpawn);
  });

  return { app: options.app, child, ipcPath, logHandle };
}

async function closeManagedChild(child: ManagedSidecarChild): Promise<void> {
  try {
    await requestJsonIpc(child.ipcPath, { type: SIDECAR_MESSAGES.SHUTDOWN }, { timeoutMs: 1200 });
  } catch {
    // Fall through to process cleanup.
  }

  if (!(await waitForProcessExit(child.child.pid, 5000))) {
    await stopProcesses([child.child.pid]);
  }

  await child.logHandle.close().catch(() => undefined);
}

export async function startPackagedSidecars(
  runtime: SidecarRuntimeContext<SidecarStamp>,
  paths: PackagedNamespacePaths,
  options: { nodeCommand: string | null },
): Promise<PackagedSidecarHandle> {
  await mkdir(paths.namespaceRoot, { recursive: true });
  await mkdir(paths.cacheRoot, { recursive: true });
  await mkdir(paths.dataRoot, { recursive: true });
  await mkdir(paths.logsRoot, { recursive: true });
  await mkdir(paths.desktopLogsRoot, { recursive: true });
  await mkdir(paths.runtimeRoot, { recursive: true });
  await mkdir(paths.electronUserDataRoot, { recursive: true });
  await mkdir(paths.electronSessionDataRoot, { recursive: true });

  const children: ManagedSidecarChild[] = [];

  try {
    const daemon = await spawnSidecarChild({
      app: APP_KEYS.DAEMON,
      entryPath: resolveSidecarEntry("@open-design/daemon", "sidecar"),
      env: {
        [SIDECAR_ENV.DAEMON_PORT]: "0",
        // Packaged daemon managed paths are deliberately delivered through
        // the sidecar launch environment. The daemon may keep its own default
        // fallback, but packaged runtime must not rely on path inference from
        // Electron userData, bundle names, or ports.
        ...createPackagedDaemonManagedPathEnv(paths),
      },
      nodeCommand: options.nodeCommand,
      paths,
      runtime,
    });
    children.push(daemon);
    const daemonStatus = await waitForStatus<DaemonStatusSnapshot>(
      daemon.ipcPath,
      (status) => status.url != null,
    );
    if (daemonStatus.url == null) throw new Error("daemon did not report a URL");

    const web = await spawnSidecarChild({
      app: APP_KEYS.WEB,
      entryPath: resolveSidecarEntry("@open-design/web", "sidecar"),
      env: {
        [SIDECAR_ENV.DAEMON_PORT]: extractPort(daemonStatus.url),
        [SIDECAR_ENV.WEB_PORT]: "0",
        OD_WEB_OUTPUT_MODE: "server",
        PORT: "0",
      },
      nodeCommand: options.nodeCommand,
      paths,
      runtime,
    });
    children.push(web);
    const webStatus = await waitForStatus<WebStatusSnapshot>(
      web.ipcPath,
      (status) => status.url != null,
    );
    if (webStatus.url == null) throw new Error("web did not report a URL");

    return {
      daemon: daemonStatus,
      web: webStatus,
      async close() {
        for (const child of [...children].reverse()) {
          await closeManagedChild(child).catch((error: unknown) => {
            console.error(`failed to close packaged ${child.app} sidecar`, error);
          });
        }
      },
    };
  } catch (error) {
    for (const child of [...children].reverse()) {
      await closeManagedChild(child).catch(() => undefined);
    }
    throw error;
  }
}
