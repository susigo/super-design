// @ts-nocheck
import express from 'express';
import {
  deleteTemplate,
  getProject,
  getTemplate,
  insertTemplate,
  listTemplates,
} from '../db.js';
import { listFiles, readProjectFile } from '../projects/index.js';
import { randomId } from './helpers.js';

export function createTemplatesRouter(ctx): import("express").Router {
  const router = express.Router();
  const { db, projectsDir } = ctx;

  // ---- Templates ----------------------------------------------------------
  // User-saved snapshots of a project's HTML files. Surfaced in the
  // "From template" tab of the new-project panel so a user can spin up
  // a fresh project pre-seeded with another project's design as a
  // starting point. Created via the project's Share menu (snapshots
  // every .html file in the project folder at the moment of save).

  router.get('/templates', (_req, res) => {
    res.json({ templates: listTemplates(db) });
  });

  router.get('/templates/:id', (req, res) => {
    const t = getTemplate(db, req.params.id);
    if (!t) return res.status(404).json({ error: 'not found' });
    res.json({ template: t });
  });

  router.post('/templates', async (req, res) => {
    try {
      const { name, description, sourceProjectId } = req.body || {};
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'name required' });
      }
      if (typeof sourceProjectId !== 'string') {
        return res.status(400).json({ error: 'sourceProjectId required' });
      }
      if (!getProject(db, sourceProjectId)) {
        return res.status(404).json({ error: 'source project not found' });
      }
      // Snapshot every HTML / sketch / text file in the source project.
      // We deliberately skip binary uploads — templates are about the
      // generated design, not the user's reference imagery.
      const files = await listFiles(projectsDir, sourceProjectId);
      const snapshot = [];
      for (const f of files) {
        if (f.kind !== 'html' && f.kind !== 'text' && f.kind !== 'code')
          continue;
        const entry = await readProjectFile(
          projectsDir,
          sourceProjectId,
          f.name,
        );
        if (entry && Buffer.isBuffer(entry.buffer)) {
          snapshot.push({
            name: f.name,
            content: entry.buffer.toString('utf8'),
          });
        }
      }
      const t = insertTemplate(db, {
        id: randomId(),
        name: name.trim(),
        description: typeof description === 'string' ? description : null,
        sourceProjectId,
        files: snapshot,
        createdAt: Date.now(),
      });
      res.json({ template: t });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  router.delete('/templates/:id', (req, res) => {
    deleteTemplate(db, req.params.id);
    res.json({ ok: true });
  });

  return router;
}
