// @ts-nocheck
import express from 'express';
import { getProject } from '../db.js';
import { generateMedia } from '../media.js';
import { openaiSizeFor } from '../capabilities/image-gen/index.js';
import {
  AUDIO_DURATIONS_SEC,
  AUDIO_MODELS_BY_KIND,
  IMAGE_MODELS,
  MEDIA_ASPECTS,
  MEDIA_PROVIDERS,
  VIDEO_LENGTHS_SEC,
  VIDEO_MODELS,
} from '../media-models.js';
import { readMaskedConfig, writeConfig } from '../media-config.js';
import { readAppConfig, writeAppConfig } from '../app-config.js';
import { writeProjectFile } from '../projects/index.js';
import { writeUsageLog } from '../billing/usage-log.js';
import { imagePriceFor } from '../billing/pricing.js';
import { isLocalSameOrigin, sendApiError } from './helpers.js';

const mediaTasks = new Map();
const TASK_TTL_AFTER_DONE_MS = 10 * 60 * 1000;

function createMediaTask(taskId, projectId, info = {}) {
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

function appendTaskProgress(task, line) {
  task.progress.push(line);
  notifyTaskWaiters(task);
}

function notifyTaskWaiters(task) {
  const wakers = Array.from(task.waiters);
  for (const w of wakers) {
    try {
      w();
    } catch {
      // Never let one bad waiter block the rest.
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

export function createMediaRouter(ctx): import("express").Router {
  const router = express.Router();
  const { db, port, projectRoot, projectsDir } = ctx;

  router.get('/media/models', (_req, res) => {
    res.json({
      providers: MEDIA_PROVIDERS,
      image: IMAGE_MODELS,
      video: VIDEO_MODELS,
      audio: AUDIO_MODELS_BY_KIND,
      aspects: MEDIA_ASPECTS,
      videoLengthsSec: VIDEO_LENGTHS_SEC,
      audioDurationsSec: AUDIO_DURATIONS_SEC,
    });
  });

  router.get('/media/config', async (_req, res) => {
    try {
      const cfg = await readMaskedConfig(projectRoot);
      res.json(cfg);
    } catch (err) {
      res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });

  router.put('/media/config', async (req, res) => {
    try {
      const cfg = await writeConfig(projectRoot, req.body);
      res.json(cfg);
    } catch (err) {
      const status = typeof err?.status === 'number' ? err.status : 400;
      res
        .status(status)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });

  router.get('/app-config', async (req, res) => {
    if (!isLocalSameOrigin(req, port)) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    try {
      const config = await readAppConfig(ctx.runtimeDataDir);
      res.json({ config });
    } catch (err) {
      res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });

  router.put('/app-config', async (req, res) => {
    if (!isLocalSameOrigin(req, port)) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    try {
      const config = await writeAppConfig(ctx.runtimeDataDir, req.body);
      res.json({ config });
    } catch (err) {
      res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });

  router.post('/projects/:id/media/generate', async (req, res) => {
    if (!isLocalSameOrigin(req, port)) {
      return res.status(403).json({
        error:
          'cross-origin request rejected: media generation is restricted to the local UI / CLI',
      });
    }

    try {
      const projectId = req.params.id;
      const project = getProject(db, projectId);
      if (!project) return res.status(404).json({ error: 'project not found' });

      const { randomUUID } = await import('node:crypto');
      const taskId = randomUUID();
      const task = createMediaTask(taskId, projectId, {
        surface: req.body?.surface,
        model: req.body?.model,
      });
      console.error(
        `[task ${taskId.slice(0, 8)}] queued model=${req.body?.model} ` +
          `surface=${req.body?.surface} ` +
          `image=${req.body?.image ? 'yes' : 'no'} ` +
          `compositionDir=${req.body?.compositionDir ? 'yes' : 'no'}`,
      );

      task.status = 'running';
      generateMedia({
        projectRoot,
        projectsRoot: projectsDir,
        projectId,
        surface: req.body?.surface,
        model: req.body?.model,
        prompt: req.body?.prompt,
        output: req.body?.output,
        aspect: req.body?.aspect,
        length:
          typeof req.body?.length === 'number' ? req.body.length : undefined,
        duration:
          typeof req.body?.duration === 'number'
            ? req.body.duration
            : undefined,
        voice: req.body?.voice,
        audioKind: req.body?.audioKind,
        compositionDir: req.body?.compositionDir,
        image: req.body?.image,
        db,
        runId: taskId,
        scenarioId:
          typeof req.body?.scenarioId === 'string'
            ? req.body.scenarioId
            : 'legacy-media',
        onProgress: (line) => appendTaskProgress(task, line),
      })
        .then((meta) => {
          task.status = 'done';
          task.file = meta;
          task.endedAt = Date.now();
          notifyTaskWaiters(task);
          console.error(
            `[task ${taskId.slice(0, 8)}] done size=${meta?.size} mime=${meta?.mime} ` +
              `elapsed=${Math.round((task.endedAt - task.startedAt) / 1000)}s`,
          );
          // Record metering only on real-provider successes — stubs and
          // provider failures should not be billed by the local price
          // table. We trust meta.intentionalStub / usedStubFallback flags
          // from generateMedia for that distinction.
          if (
            !meta?.intentionalStub &&
            !meta?.usedStubFallback &&
            meta?.surface &&
            meta?.model
          ) {
            try {
              const reqAspect =
                typeof req.body?.aspect === 'string' ? req.body.aspect : null;
              const sizeStr = openaiSizeFor(meta.model, reqAspect);
              if (meta.surface === 'image') {
                const cost = imagePriceFor(meta.model, sizeStr);
                writeUsageLog(db, {
                  ts: Date.now(),
                  projectId,
                  conversationId:
                    typeof req.body?.conversationId === 'string'
                      ? req.body.conversationId
                      : null,
                  messageId:
                    typeof req.body?.messageId === 'string'
                      ? req.body.messageId
                      : null,
                  surface: 'image',
                  provider: meta.providerId || 'unknown',
                  model: meta.model,
                  imageCount: 1,
                  imageSize: sizeStr,
                  costUsdEstimate: cost,
                  costSource:
                    cost == null ? 'pricing-table-missing' : 'pricing-table',
                });
              }
            } catch {
              // metering must never break the user's flow
            }
          }
        })
        .catch((err) => {
          task.status = 'failed';
          task.error = {
            message: String(err && err.message ? err.message : err),
            status: typeof err?.status === 'number' ? err.status : 400,
            code: err?.code,
          };
          task.endedAt = Date.now();
          notifyTaskWaiters(task);
          console.error(
            `[task ${taskId.slice(0, 8)}] failed status=${task.error.status} ` +
              `message=${(task.error.message || '').slice(0, 240)}`,
          );
        });

      res.status(202).json({
        taskId,
        status: task.status,
        startedAt: task.startedAt,
      });
    } catch (err) {
      const status = typeof err?.status === 'number' ? err.status : 400;
      const code = err?.code;
      const body = { error: String(err && err.message ? err.message : err) };
      if (code) body.code = code;
      res.status(status).json(body);
    }
  });

  // ---- Deck image panel (gpt-image-2) ----
  //
  // The deck-image side panel calls this for each placeholder
  // (`<img data-od-image-prompt="…" data-od-image-id="…">`). We run
  // generateMedia synchronously with a 90s ceiling so a hung upstream
  // can't pin a daemon thread. The response is a single JSON object
  // ready to plug back into the iframe.
  router.post('/projects/:id/deck/image', async (req, res) => {
    if (!isLocalSameOrigin(req, port)) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const projectId = req.params.id;
    const project = getProject(db, projectId);
    if (!project) return res.status(404).json({ error: 'project not found' });

    const prompt =
      typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!prompt) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'prompt is required');
    }
    const aspect =
      typeof req.body?.aspect === 'string' ? req.body.aspect : '1:1';
    const model =
      typeof req.body?.model === 'string' && req.body.model
        ? req.body.model
        : 'gpt-image-2';
    const placeholderId =
      typeof req.body?.placeholderId === 'string'
        ? req.body.placeholderId
        : null;
    const conversationId =
      typeof req.body?.conversationId === 'string'
        ? req.body.conversationId
        : null;

    try {
      const meta = await generateMedia({
        projectRoot,
        projectsRoot: projectsDir,
        projectId,
        surface: 'image',
        model,
        prompt,
        aspect,
      });
      // Per-call usage row — the same shape as the media-task path so
      // downstream usage views aggregate consistently. Skip on stub /
      // provider-error responses; users shouldn't see a price tag for
      // bytes the provider didn't produce.
      if (
        !meta?.intentionalStub &&
        !meta?.usedStubFallback &&
        meta?.surface === 'image' &&
        meta?.model
      ) {
        try {
          const sizeStr = openaiSizeFor(meta.model, aspect);
          const cost = imagePriceFor(meta.model, sizeStr);
          writeUsageLog(db, {
            ts: Date.now(),
            projectId,
            conversationId,
            surface: 'image',
            provider: meta.providerId || 'unknown',
            model: meta.model,
            imageCount: 1,
            imageSize: sizeStr,
            costUsdEstimate: cost,
            costSource: cost == null ? 'pricing-table-missing' : 'pricing-table',
          });
        } catch {
          /* metering must never break the user's flow */
        }
      }
      return res.json({
        placeholderId,
        src: `/api/projects/${encodeURIComponent(projectId)}/raw/${encodeURIComponent(meta.name)}`,
        name: meta.name,
        sizeBytes: meta.size,
        mime: meta.mime,
        model: meta.model,
        providerId: meta.providerId,
        providerNote: meta.providerNote,
        providerError: meta.providerError ?? null,
      });
    } catch (err) {
      const status = typeof err?.status === 'number' ? err.status : 400;
      const code = err?.code;
      const body = { error: String(err && err.message ? err.message : err) };
      if (code) body.code = code;
      return res.status(status).json(body);
    }
  });

  // Write back deck HTML after the image panel patches `<img src>`.
  // We accept a JSON body { name: 'index.html', content: '<!doctype …' }
  // and route it through the existing project file writer which already
  // sanitises the filename and prevents path traversal.
  router.put('/projects/:id/deck/html', async (req, res) => {
    if (!isLocalSameOrigin(req, port)) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const projectId = req.params.id;
    const project = getProject(db, projectId);
    if (!project) return res.status(404).json({ error: 'project not found' });

    const name =
      typeof req.body?.name === 'string' && req.body.name
        ? req.body.name
        : 'index.html';
    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    if (!content) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'content required');
    }
    if (content.length > 8 * 1024 * 1024) {
      return sendApiError(res, 413, 'BAD_REQUEST', 'content too large (max 8MB)');
    }
    try {
      const file = await writeProjectFile(projectsDir, projectId, name, content);
      res.json({ ok: true, file });
    } catch (err) {
      const msg = String(err && err.message ? err.message : err);
      res.status(400).json({ error: msg });
    }
  });

  router.post('/media/tasks/:id/wait', async (req, res) => {
    if (!isLocalSameOrigin(req, port)) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const taskId = req.params.id;
    const task = mediaTasks.get(taskId);
    if (!task) return res.status(404).json({ error: 'task not found' });

    const since = Number.isFinite(req.body?.since) ? Number(req.body.since) : 0;
    const requestedTimeout = Number.isFinite(req.body?.timeoutMs)
      ? Number(req.body.timeoutMs)
      : 25_000;
    const timeoutMs = Math.min(Math.max(requestedTimeout, 0), 25_000);

    const respond = () => {
      if (res.writableEnded) return;
      const snapshot = {
        taskId,
        status: task.status,
        startedAt: task.startedAt,
        endedAt: task.endedAt,
        progress: task.progress.slice(since),
        nextSince: task.progress.length,
      };
      if (task.status === 'done') snapshot.file = task.file;
      if (task.status === 'failed') snapshot.error = task.error;
      res.json(snapshot);
    };

    if (
      task.status === 'done' ||
      task.status === 'failed' ||
      task.progress.length > since
    ) {
      return respond();
    }

    let resolved = false;
    const wake = () => {
      if (resolved) return;
      resolved = true;
      task.waiters.delete(wake);
      clearTimeout(timer);
      respond();
    };
    task.waiters.add(wake);
    const timer = setTimeout(wake, timeoutMs);
    res.on('close', wake);
  });

  router.get('/projects/:id/media/tasks', (req, res) => {
    if (!isLocalSameOrigin(req, port)) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const projectId = req.params.id;
    const includeDone =
      req.query.includeDone === '1' || req.query.includeDone === 'true';
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
    res.json({ tasks });
  });

  return router;
}
