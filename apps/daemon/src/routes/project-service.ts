// @ts-nocheck
import fs from 'node:fs';
import {
  getTemplate,
  insertConversation,
  insertProject,
  setTabs,
} from '../db.js';
import {
  ensureProject,
  projectDir,
  writeProjectFile,
} from '../projects/index.js';
import { importClaudeDesignZip } from '../resources/claude-design-import.js';
import { randomId } from './helpers.js';

export async function createProjectFromRequest({ db, projectsDir, input }) {
  const { id, name, skillId, designSystemId, pendingPrompt, metadata } =
    input || {};
  if (typeof id !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(id)) {
    return { error: { status: 400, code: 'BAD_REQUEST', message: 'invalid project id' } };
  }
  if (typeof name !== 'string' || !name.trim()) {
    return { error: { status: 400, code: 'BAD_REQUEST', message: 'name required' } };
  }

  const now = Date.now();
  const project = insertProject(db, {
    id,
    name: name.trim(),
    skillId: skillId ?? null,
    designSystemId: designSystemId ?? null,
    pendingPrompt: pendingPrompt || null,
    metadata: metadata && typeof metadata === 'object' ? metadata : null,
    createdAt: now,
    updatedAt: now,
  });

  const conversationId = randomId();
  insertConversation(db, {
    id: conversationId,
    projectId: id,
    title: null,
    createdAt: now,
    updatedAt: now,
  });

  await seedTemplateFiles({ db, projectsDir, projectId: id, metadata });

  return { project, conversationId };
}

async function seedTemplateFiles({ db, projectsDir, projectId, metadata }) {
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    metadata.kind !== 'template' ||
    typeof metadata.templateId !== 'string'
  ) {
    return;
  }

  const tpl = getTemplate(db, metadata.templateId);
  if (!tpl || !Array.isArray(tpl.files) || tpl.files.length === 0) return;

  await ensureProject(projectsDir, projectId);
  for (const f of tpl.files) {
    if (!f || typeof f.name !== 'string' || typeof f.content !== 'string') {
      continue;
    }
    try {
      await writeProjectFile(
        projectsDir,
        projectId,
        f.name,
        Buffer.from(f.content, 'utf8'),
      );
    } catch {
      // Best-effort template snapshot seeding.
    }
  }
}

export async function importClaudeDesignProject({ db, projectsDir, file }) {
  if (!file) {
    return { error: { status: 400, message: 'zip file required' } };
  }

  const originalName = file.originalname || 'Claude Design export.zip';
  if (!/\.zip$/i.test(originalName)) {
    await fs.promises.unlink(file.path).catch(() => {});
    return { error: { status: 400, message: 'expected a .zip file' } };
  }

  const id = randomId();
  const now = Date.now();
  const baseName =
    originalName.replace(/\.zip$/i, '').trim() || 'Claude Design import';
  let imported;
  try {
    imported = await importClaudeDesignZip(
      file.path,
      projectDir(projectsDir, id),
    );
  } finally {
    await fs.promises.unlink(file.path).catch(() => {});
  }

  const project = insertProject(db, {
    id,
    name: baseName,
    skillId: null,
    designSystemId: null,
    pendingPrompt: `Imported from Claude Design ZIP: ${originalName}. Continue editing ${imported.entryFile}.`,
    metadata: {
      kind: 'prototype',
      importedFrom: 'claude-design',
      entryFile: imported.entryFile,
      sourceFileName: originalName,
    },
    createdAt: now,
    updatedAt: now,
  });
  const conversationId = randomId();
  insertConversation(db, {
    id: conversationId,
    projectId: id,
    title: 'Imported Claude Design project',
    createdAt: now,
    updatedAt: now,
  });
  setTabs(db, id, [imported.entryFile], imported.entryFile);

  return {
    project,
    conversationId,
    entryFile: imported.entryFile,
    files: imported.files,
  };
}
