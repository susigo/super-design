// @ts-nocheck

const mediaTasks = new Map();
const TASK_TTL_AFTER_DONE_MS = 10 * 60 * 1000;

export function createMediaTask(taskId, projectId, info = {}) {
  const task = {
    id: taskId,
    projectId,
    status: 'queued',
    surface: info.surface,
    model: info.model,
    progress: [],
    file: null,
    error: null,
    startedAt: Date.now(),
    endedAt: null,
    waiters: new Set(),
  };
  mediaTasks.set(taskId, task);
  return task;
}

export function getMediaTask(taskId) {
  return mediaTasks.get(taskId);
}

export function appendTaskProgress(task, line) {
  task.progress.push(line);
  notifyTaskWaiters(task);
}

export function notifyTaskWaiters(task) {
  const wakers = Array.from(task.waiters);
  for (const w of wakers) {
    try {
      w();
    } catch {
    }
  }
  if (
    (task.status === 'done' || task.status === 'failed') &&
    !task._gcScheduled
  ) {
    task._gcScheduled = true;
    setTimeout(() => {
      if (task.waiters.size === 0) mediaTasks.delete(task.id);
    }, TASK_TTL_AFTER_DONE_MS).unref?.();
  }
}

export function listProjectMediaTasks(projectId, { includeDone = false } = {}) {
  const tasks = [];
  for (const t of mediaTasks.values()) {
    if (t.projectId !== projectId) continue;
    const isTerminal = t.status === 'done' || t.status === 'failed';
    if (isTerminal && !includeDone) continue;
    tasks.push({
      taskId: t.id,
      status: t.status,
      startedAt: t.startedAt,
      endedAt: t.endedAt,
      elapsed: Math.round(((t.endedAt ?? Date.now()) - t.startedAt) / 1000),
      surface: t.surface,
      model: t.model,
      progress: t.progress.slice(-3),
      progressCount: t.progress.length,
      ...(t.status === 'done' ? { file: t.file } : {}),
      ...(t.status === 'failed' ? { error: t.error } : {}),
    });
  }
  tasks.sort((a, b) => b.startedAt - a.startedAt);
  return tasks;
}
