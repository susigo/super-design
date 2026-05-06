// @ts-nocheck
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  findDesignSystemRoot,
  listDesignSystems,
  readDesignSystem,
} from '../resources/design-systems.js';
import { extractDesignSystem } from '../resources/design-import-extract.js';
import { sanitizeDesignSystemSlug } from '../prompts/design-import.js';
import { renderDesignSystemPreview } from '../resources/design-system-preview.js';
import { renderDesignSystemShowcase } from '../resources/design-system-showcase.js';
import { listPromptTemplates, readPromptTemplate } from '../resources/prompt-templates.js';
import { decodeMultipartFilename, kindFor, mimeFor, sanitizeName } from '../projects/index.js';
import { textPriceFor } from '../billing/pricing.js';
import { writeUsageLog } from '../billing/usage-log.js';
import { isLocalSameOrigin, sendApiError, validateExternalApiBaseUrl } from './helpers.js';

const UPLOAD_DIR = path.join(os.tmpdir(), 'od-uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const importUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      file.originalname = decodeMultipartFilename(file.originalname);
      const safe = sanitizeName(file.originalname);
      cb(
        null,
        `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`,
      );
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
});

export function createDesignSystemsRouter(ctx): import("express").Router {
  const router = express.Router();
  const { db, port, designSystemRoots, userDesignSystemsDir, stagingDir, promptTemplatesDir } = ctx;

  router.get('/design-systems', async (_req, res) => {
    try {
      const systems = await listDesignSystems(designSystemRoots);
      res.json({
        designSystems: systems.map(({ body, ...rest }) => rest),
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/design-systems/:id', async (req, res) => {
    try {
      const body = await readDesignSystem(designSystemRoots, req.params.id);
      if (body === null)
        return res.status(404).json({ error: 'design system not found' });
      res.json({ id: req.params.id, body });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/prompt-templates', async (_req, res) => {
    try {
      const templates = await listPromptTemplates(promptTemplatesDir);
      res.json({
        promptTemplates: templates.map(({ prompt: _prompt, ...rest }) => rest),
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/prompt-templates/:surface/:id', async (req, res) => {
    try {
      const tpl = await readPromptTemplate(
        promptTemplatesDir,
        req.params.surface,
        req.params.id,
      );
      if (!tpl)
        return res.status(404).json({ error: 'prompt template not found' });
      res.json({ promptTemplate: tpl });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Showcase HTML for a design system — palette swatches, typography
  // samples, sample components, and the full DESIGN.md rendered as prose.
  // Built at request time from the on-disk DESIGN.md so any update to the
  // file shows up on the next view, no rebuild needed.
  router.get('/design-systems/:id/preview', async (req, res) => {
    try {
      const body = await readDesignSystem(designSystemRoots, req.params.id);
      if (body === null)
        return res.status(404).type('text/plain').send('not found');
      const html = renderDesignSystemPreview(req.params.id, body);
      res.type('text/html').send(html);
    } catch (err) {
      res.status(500).type('text/plain').send(String(err));
    }
  });

  // Marketing-style showcase derived from the same DESIGN.md — full landing
  // page parameterised by the system's tokens. Same lazy-render strategy as
  // /preview: built at request time, no caching.
  router.get('/design-systems/:id/showcase', async (req, res) => {
    try {
      const body = await readDesignSystem(designSystemRoots, req.params.id);
      if (body === null)
        return res.status(404).type('text/plain').send('not found');
      const html = renderDesignSystemShowcase(req.params.id, body);
      res.type('text/html').send(html);
    } catch (err) {
      res.status(500).type('text/plain').send(String(err));
    }
  });

  // ---- Sample importer → DESIGN.md ----
  //
  // 1. POST /api/design-systems/import/stage  (multipart 'file')
  //    Stages a single source file under stagingDir. Returns
  //    { stagingId, kind, mime, size }. Caller hangs on to stagingId.
  //
  // 2. POST /api/design-systems/import/extract
  //    Body: { stagingId, baseUrl, apiKey, model, protocol?, hint? }
  //    Calls vision (BYOK creds) and returns the rendered DESIGN.md
  //    body + suggested slug. Streaming SSE adds no value here because
  //    the upstream `tool_use` is a single-shot — no token stream to
  //    forward — so we keep it as a single JSON response with up to
  //    a 90s upstream ceiling.
  //
  // 3. POST /api/design-systems/import/save
  //    Body: { slug, body, sourceFileName? }
  //    Validates the body parses with extractCategory/Swatches and
  //    writes <userDesignSystemsDir>/<slug>/DESIGN.md.
  //
  // 4. DELETE /api/design-systems/:id
  //    Only when the id resides in userDesignSystemsDir. Built-ins
  //    return 403.

  router.post(
    '/design-systems/import/stage',
    importUpload.single('file'),
    (req, res) => {
      if (!isLocalSameOrigin(req, port)) {
        return res.status(403).json({ error: 'cross-origin request rejected' });
      }
      if (!req.file) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'file is required');
      }
      try {
        const stagedName = `${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}-${sanitizeName(req.file.originalname || 'source')}`;
        const stagedPath = path.join(stagingDir, stagedName);
        fs.copyFileSync(req.file.path, stagedPath);
        try {
          fs.unlinkSync(req.file.path);
        } catch {
          /* ignore unlink failure on the upload tmpfile */
        }
        return res.json({
          stagingId: stagedName,
          kind: kindFor(stagedName),
          mime: req.file.mimetype || mimeFor(stagedName),
          size: req.file.size,
          originalName: req.file.originalname,
        });
      } catch (err) {
        return res
          .status(500)
          .json({ error: String(err && err.message ? err.message : err) });
      }
    },
  );

  router.post('/design-systems/import/extract', async (req, res) => {
    if (!isLocalSameOrigin(req, port)) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const {
      stagingId,
      baseUrl,
      apiKey,
      model,
      protocol = 'anthropic',
      hint,
    } = req.body || {};
    if (!stagingId || !baseUrl || !apiKey || !model) {
      return sendApiError(
        res,
        400,
        'BAD_REQUEST',
        'stagingId, baseUrl, apiKey, and model are required',
      );
    }
    const validated = validateExternalApiBaseUrl(baseUrl);
    if (validated.error) {
      return sendApiError(
        res,
        validated.forbidden ? 403 : 400,
        validated.forbidden ? 'FORBIDDEN' : 'BAD_REQUEST',
        validated.error,
      );
    }
    const safeStagingName = sanitizeName(String(stagingId));
    const stagedPath = path.join(stagingDir, safeStagingName);
    try {
      const stats = await import('node:fs/promises').then((m) =>
        m.stat(stagedPath),
      );
      if (!stats.isFile()) throw new Error('staged file not found');
    } catch (err) {
      return sendApiError(res, 404, 'NOT_FOUND', 'staged source not found');
    }
    try {
      const result = await extractDesignSystem({
        stagedPath,
        mime: mimeFor(stagedPath),
        hint,
        baseUrl,
        apiKey,
        model,
        protocol,
      });
      // Usage row for the import call. We don't have token counts
      // from a tool_use response unless the provider adds them; record
      // what we know so the metering page still reflects the activity.
      try {
        const tokenInfo = result?.raw?.usage || {};
        const inputTokens =
          tokenInfo.input_tokens ?? tokenInfo.prompt_tokens ?? null;
        const outputTokens =
          tokenInfo.output_tokens ?? tokenInfo.completion_tokens ?? null;
        const estimate =
          inputTokens != null || outputTokens != null
            ? textPriceFor(model, {
                inputTokens: inputTokens ?? 0,
                outputTokens: outputTokens ?? 0,
              })
            : null;
        writeUsageLog(db, {
          ts: Date.now(),
          surface: 'text',
          provider:
            protocol === 'anthropic'
              ? 'anthropic-design-import'
              : 'openai-design-import',
          model,
          inputTokens,
          outputTokens,
          costUsdEstimate: estimate,
          costSource: estimate == null ? 'pricing-table-missing' : 'pricing-table',
        });
      } catch {
        /* metering must never break the user's flow */
      }
      return res.json({ slug: result.slug, body: result.body });
    } catch (err) {
      const status = typeof err?.status === 'number' ? err.status : 502;
      return res
        .status(status)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });

  router.post('/design-systems/import/save', async (req, res) => {
    if (!isLocalSameOrigin(req, port)) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const slugRaw = typeof req.body?.slug === 'string' ? req.body.slug : '';
    const body = typeof req.body?.body === 'string' ? req.body.body : '';
    if (!slugRaw || !body) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'slug and body required');
    }
    if (!/^#\s+\S+/m.test(body)) {
      return sendApiError(
        res,
        400,
        'INVALID_DESIGN_MD',
        'design system body must start with an H1 title',
      );
    }
    const slug = sanitizeDesignSystemSlug(slugRaw);
    const dir = path.join(userDesignSystemsDir, slug);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'DESIGN.md'), body, 'utf8');
      const systems = await listDesignSystems(designSystemRoots);
      const summary = systems.find((s) => s.id === slug);
      return res.json({
        ok: true,
        system: summary
          ? (() => {
              const { body: _b, ...rest } = summary;
              return rest;
            })()
          : { id: slug },
      });
    } catch (err) {
      return res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });

  router.delete('/design-systems/:id', async (req, res) => {
    if (!isLocalSameOrigin(req, port)) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const id = req.params.id;
    const userPath = path.join(userDesignSystemsDir, id, 'DESIGN.md');
    if (!fs.existsSync(userPath)) {
      // Either the id doesn't exist OR it lives in the read-only
      // built-in dir. Both map to 403 since we never let a delete
      // touch the built-in catalog.
      return sendApiError(
        res,
        403,
        'FORBIDDEN',
        'design system is not user-imported (built-ins are read-only)',
      );
    }
    try {
      fs.rmSync(path.join(userDesignSystemsDir, id), {
        recursive: true,
        force: true,
      });
      return res.json({ ok: true });
    } catch (err) {
      return res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });

  return router;
}
