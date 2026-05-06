import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const guardedRoots = ['packages/capabilities', 'packages/scenarios'];

interface GuardedPackage {
  root: string;
  packageJsonPath: string;
  sourcePrefix: string;
}

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function tryGit(args: string[]): string | null {
  try {
    return git(args);
  } catch {
    return null;
  }
}

function repositoryPath(filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

function resolveBaseRef(): string {
  const explicitBase = process.env.OD_SEMVER_BASE?.trim();
  if (explicitBase) return explicitBase;

  const githubBase = process.env.GITHUB_BASE_REF?.trim();
  if (githubBase) {
    const remoteRef = `origin/${githubBase}`;
    const mergeBase = tryGit(['merge-base', 'HEAD', remoteRef]);
    if (mergeBase) return mergeBase;
    throw new Error(`Could not resolve ${remoteRef}. Ensure CI checks out enough git history before running SemVer guardrails.`);
  }

  const previousCommit = tryGit(['rev-parse', '--verify', 'HEAD^']);
  if (previousCommit) return previousCommit;

  throw new Error('Could not resolve a base commit. Set OD_SEMVER_BASE to the ref that capability/scenario packages should be compared against.');
}

async function listGuardedPackages(): Promise<GuardedPackage[]> {
  const packages: GuardedPackage[] = [];

  for (const guardedRoot of guardedRoots) {
    const absoluteRoot = path.join(repoRoot, guardedRoot);
    const entries = await readdir(absoluteRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const root = `${guardedRoot}/${entry.name}`;
      packages.push({
        root,
        packageJsonPath: `${root}/package.json`,
        sourcePrefix: `${root}/src/`,
      });
    }
  }

  return packages;
}

function changedFilesSince(baseRef: string): Set<string> {
  const output = git(['diff', '--name-only', baseRef, '--', ...guardedRoots]);
  if (!output) return new Set();
  return new Set(output.split('\n').filter(Boolean));
}

function fileAtRef(ref: string, filePath: string): string | null {
  return tryGit(['show', `${ref}:${filePath}`]);
}

async function currentJson(filePath: string): Promise<Record<string, unknown>> {
  const source = await readFile(path.join(repoRoot, filePath), 'utf8');
  return JSON.parse(source) as Record<string, unknown>;
}

function jsonAtRef(ref: string, filePath: string): Record<string, unknown> | null {
  const source = fileAtRef(ref, filePath);
  if (source == null) return null;
  return JSON.parse(source) as Record<string, unknown>;
}

const baseRef = resolveBaseRef();
const changedFiles = changedFilesSince(baseRef);
const packages = await listGuardedPackages();
const failures: string[] = [];

for (const guardedPackage of packages) {
  const publicSourceChanged = [...changedFiles].some((filePath) => filePath.startsWith(guardedPackage.sourcePrefix));
  if (!publicSourceChanged) continue;

  const basePackageJson = jsonAtRef(baseRef, guardedPackage.packageJsonPath);
  if (basePackageJson == null) continue;

  const currentPackageJson = await currentJson(guardedPackage.packageJsonPath);
  const baseVersion = basePackageJson.version;
  const currentVersion = currentPackageJson.version;

  if (typeof baseVersion !== 'string' || typeof currentVersion !== 'string') {
    failures.push(`${guardedPackage.packageJsonPath} must contain a string version field.`);
    continue;
  }

  if (baseVersion === currentVersion) {
    const changedPublicFiles = [...changedFiles]
      .filter((filePath) => filePath.startsWith(guardedPackage.sourcePrefix))
      .map((filePath) => `  - ${filePath}`)
      .join('\n');
    failures.push(`${guardedPackage.root} changed public source without a package version bump:\n${changedPublicFiles}`);
  }
}

if (failures.length > 0) {
  console.error('Capability/scenario SemVer guardrail failed:');
  for (const failure of failures) {
    console.error(`\n${failure}`);
  }
  console.error('\nBump the affected package version when changing public capability/scenario source. Set OD_SEMVER_BASE to override the comparison ref.');
  process.exitCode = 1;
} else {
  console.log(`Capability/scenario SemVer guardrail passed against ${baseRef}.`);
}
