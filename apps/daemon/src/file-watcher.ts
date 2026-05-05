import { watch, stat, type FSWatcher } from 'node:fs';
import { relative, normalize } from 'node:path';

export interface FileChangeEvent {
  path: string;
  changeKind: 'create' | 'modify' | 'delete';
  size?: number;
}

export interface ProjectFileWatcher {
  stop(): void;
}

const DEBOUNCE_MS = 100;
const IGNORED_PATTERNS = /(?:^|[\\/])(?:\.od|\.git|node_modules|\.tmp)(?:[\\/]|$)/;

export function createProjectFileWatcher(
  cwd: string,
  onFileChange: (event: FileChangeEvent) => void,
): ProjectFileWatcher {
  const pending = new Map<string, NodeJS.Timeout>();
  let stopped = false;
  let watcher: FSWatcher | null = null;

  try {
    watcher = watch(cwd, { recursive: true }, (_eventType, filename) => {
      if (stopped || !filename) return;

      const normalized = filename.replace(/\\/g, '/');
      if (IGNORED_PATTERNS.test(normalized)) return;

      if (pending.has(normalized)) {
        clearTimeout(pending.get(normalized)!);
      }

      pending.set(
        normalized,
        setTimeout(() => {
          pending.delete(normalized);
          if (stopped) return;

          const fullPath = normalize(`${cwd}/${normalized}`);
          stat(fullPath, (err, stats) => {
            if (stopped) return;
            if (err) {
              onFileChange({ path: normalized, changeKind: 'delete' });
            } else if (stats.isFile()) {
              const age = Date.now() - stats.birthtimeMs;
              const changeKind = age < 1000 ? 'create' : 'modify';
              onFileChange({ path: normalized, changeKind, size: stats.size });
            }
          });
        }, DEBOUNCE_MS),
      );
    });
  } catch {
    // fs.watch may not be supported on all platforms/filesystems
  }

  return {
    stop() {
      stopped = true;
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
      watcher?.close();
      watcher = null;
    },
  };
}
