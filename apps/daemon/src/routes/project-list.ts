import {
  listLatestProjectRunStatuses,
  listProjects,
  listProjectsAwaitingInput,
} from '../db.js';
import {
  composeProjectDisplayStatus,
  normalizeProjectDisplayStatus,
} from '../project-status/helpers.js';

function projectStatusFromRun(run: any) {
  return {
    value: normalizeProjectDisplayStatus(run.status),
    updatedAt: run.updatedAt,
    runId: run.id,
  };
}

export function buildProjectsResponse(db: any, runs: any) {
  const latestRunStatuses = listLatestProjectRunStatuses(db);
  const awaitingInputProjects = listProjectsAwaitingInput(db);
  const activeRunStatuses = new Map();

  for (const run of runs.list()) {
    if (!run.projectId) continue;
    const runStatus = projectStatusFromRun(run);
    if (runs.isTerminal(run.status)) {
      const existing = latestRunStatuses.get(run.projectId);
      if (!existing || run.updatedAt > (existing.updatedAt ?? 0)) {
        latestRunStatuses.set(run.projectId, runStatus);
      }
    } else {
      const existing = activeRunStatuses.get(run.projectId);
      if (!existing || run.updatedAt > (existing.updatedAt ?? 0)) {
        activeRunStatuses.set(run.projectId, runStatus);
      }
    }
  }

  return {
    projects: listProjects(db).map((project: any) => ({
      ...project,
      status: composeProjectDisplayStatus(
        activeRunStatuses.get(project.id) ??
          latestRunStatuses.get(project.id) ?? { value: 'not_started' },
        awaitingInputProjects,
        project.id,
      ),
    })),
  };
}
