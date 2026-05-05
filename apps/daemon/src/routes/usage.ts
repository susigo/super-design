// @ts-nocheck
import express from 'express';
import {
  deleteUsage,
  listUsageGrouped,
  listUsageRecent,
  summarizeUsage,
} from '../usage-log.js';
import { isLocalSameOrigin } from './helpers.js';

function parseTsParam(value, fallback) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function createUsageRouter(ctx): import("express").Router {
  const router = express.Router();
  const { db, port } = ctx;

  // ---- BYOK transparent metering ----
  //
  // Read-only views over the usage_logs table. Writes happen as a
  // side-effect of chat / proxy / media generation (see writeUsageLog
  // call sites). All four routes are restricted to local same-
  // origin so a remote browser can't snoop another user's history.

  router.get('/usage', (req, res) => {
    if (!isLocalSameOrigin(req, port)) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    try {
      const from = parseTsParam(req.query.from, 0);
      const to = parseTsParam(req.query.to, Number.MAX_SAFE_INTEGER);
      const groupBy =
        typeof req.query.groupBy === 'string' ? req.query.groupBy : 'surface';
      const projectId =
        typeof req.query.projectId === 'string' && req.query.projectId
          ? req.query.projectId
          : undefined;
      const result = listUsageGrouped(db, { from, to, groupBy, projectId });
      res.json(result);
    } catch (err) {
      res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });

  router.get('/usage/summary', (req, res) => {
    if (!isLocalSameOrigin(req, port)) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    try {
      const period =
        typeof req.query.period === 'string' && req.query.period
          ? req.query.period
          : '30d';
      res.json(summarizeUsage(db, period));
    } catch (err) {
      res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });

  router.get('/usage/recent', (req, res) => {
    if (!isLocalSameOrigin(req, port)) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    try {
      const limit = Number.parseInt(String(req.query.limit ?? '50'), 10);
      res.json({
        rows: listUsageRecent(db, Number.isFinite(limit) ? limit : 50),
      });
    } catch (err) {
      res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });

  router.delete('/usage', (req, res) => {
    if (!isLocalSameOrigin(req, port)) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    try {
      const before = parseTsParam(req.query.before, undefined);
      const removed = deleteUsage(
        db,
        typeof before === 'number' ? before : undefined,
      );
      res.json({ ok: true, removed });
    } catch (err) {
      res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });

  return router;
}
