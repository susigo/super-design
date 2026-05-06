// @ts-nocheck
import express from 'express';
import {
  deleteProject as dbDeleteProject,
  getProject,
  updateProject,
} from '../db.js';
import { removeProjectDir } from '../projects/index.js';
import { sendApiError } from './helpers.js';
import { buildProjectsResponse } from './project-list.js';
import { createProjectCollaborationRouter } from './project-collaboration.js';
import { createProjectDeploymentsRouter } from './project-deployments.js';
import { createProjectFilesRouter } from './project-files.js';
import {
  createProjectFromRequest,
  importClaudeDesignProject,
} from './project-service.js';
import { importUpload } from './project-uploads.js';

export function createProjectsRouter(ctx): import("express").Router {
  const router = express.Router();
  const { db, projectsDir } = ctx;

  router.use(createProjectCollaborationRouter(ctx));
  router.use(createProjectDeploymentsRouter(ctx));
  router.use(createProjectFilesRouter(ctx));

  // ---- Projects (DB-backed) -------------------------------------------------

  router.get('/projects', (_req, res) => {
    try {
      /** @type {import('@open-design/contracts').ProjectsResponse} */
      const body = buildProjectsResponse(db, ctx.design.runs);
      res.json(body);
    } catch (err) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err));
    }
  });

  router.post('/projects', async (req, res) => {
    try {
      const result = await createProjectFromRequest({
        db,
        projectsDir,
        input: req.body || {},
      });
      if (result.error) {
        return sendApiError(
          res,
          result.error.status,
          result.error.code,
          result.error.message,
        );
      }
      /** @type {import('@open-design/contracts').CreateProjectResponse} */
      const body = {
        project: result.project,
        conversationId: result.conversationId,
      };
      res.json(body);
    } catch (err) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err));
    }
  });

  router.post(
    '/import/claude-design',
    importUpload.single('file'),
    async (req, res) => {
      try {
        const result = await importClaudeDesignProject({
          db,
          projectsDir,
          file: req.file,
        });
        if (result.error) {
          return res.status(result.error.status).json({ error: result.error.message });
        }
        res.json(result);
      } catch (err) {
        res.status(400).json({ error: String(err) });
      }
    },
  );

  router.get('/projects/:id', (req, res) => {
    const project = getProject(db, req.params.id);
    if (!project)
      return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'not found');
    /** @type {import('@open-design/contracts').ProjectResponse} */
    const body = { project };
    res.json(body);
  });

  router.patch('/projects/:id', (req, res) => {
    try {
      const patch = req.body || {};
      const project = updateProject(db, req.params.id, patch);
      if (!project)
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'not found');
      /** @type {import('@open-design/contracts').ProjectResponse} */
      const body = { project };
      res.json(body);
    } catch (err) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err));
    }
  });

  router.delete('/projects/:id', async (req, res) => {
    try {
      dbDeleteProject(db, req.params.id);
      await removeProjectDir(projectsDir, req.params.id).catch(() => {});
      /** @type {import('@open-design/contracts').OkResponse} */
      const body = { ok: true };
      res.json(body);
    } catch (err) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err));
    }
  });

  return router;
}
