// @ts-nocheck
// Usage log helpers — append-only metering for BYOK transparent costs.
//
// Design rules:
//   1. Writes never throw. Metering failure must not break the user's
//      generation flow. We `console.warn` and move on.
//   2. We do NOT store prompt content or message bodies — only token
//      counts, model id, surface, and the provider's usage payload.
//      `raw_json` is opaque on purpose so future fields can land
//      without a migration.
//   3. cost_source records where the number came from:
//        - 'provider'              — supplied by upstream API (best)
//        - 'pricing-table'         — looked up in pricing.ts
//        - 'pricing-table-missing' — model isn't in pricing.ts; cost null
//
// Each row is a single API call: one chat turn, one image generation,
// one TTS request. Aggregations happen in API handlers via SQL GROUP BY.

import { randomUUID } from 'node:crypto';

const ALLOWED_SURFACES = new Set(['text', 'image', 'video', 'audio']);
const ALLOWED_COST_SOURCES = new Set([
  'provider',
  'pricing-table',
  'pricing-table-missing',
]);

/**
 * Insert one usage row. All numeric fields are optional — pass only
 * what the upstream actually reported. Failure swallows the error.
 *
 * @param db - the better-sqlite3 instance from db.ts
 * @param entry - the usage record (see fields below)
 */
export function writeUsageLog(db, entry) {
  if (!db || !entry) return;
  try {
    const surface = ALLOWED_SURFACES.has(entry.surface)
      ? entry.surface
      : 'text';
    const costSource = ALLOWED_COST_SOURCES.has(entry.costSource)
      ? entry.costSource
      : 'pricing-table-missing';
    const id = entry.id || `use_${randomUUID().slice(0, 12)}`;
    const ts = typeof entry.ts === 'number' ? entry.ts : Date.now();
    const provider = String(entry.provider || 'unknown').slice(0, 64);
    const model = String(entry.model || 'unknown').slice(0, 128);
    const rawJson =
      entry.raw != null ? safeStringify(entry.raw, 8 * 1024) : null;
    db.prepare(
      `INSERT OR IGNORE INTO usage_logs (
         id, ts, project_id, conversation_id, message_id, agent_id,
         surface, provider, model,
         input_tokens, output_tokens, cached_read_tokens, cached_write_tokens,
         image_count, image_size, audio_seconds,
         cost_usd_estimate, cost_source, raw_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      ts,
      entry.projectId ?? null,
      entry.conversationId ?? null,
      entry.messageId ?? null,
      entry.agentId ?? null,
      surface,
      provider,
      model,
      asInt(entry.inputTokens),
      asInt(entry.outputTokens),
      asInt(entry.cachedReadTokens),
      asInt(entry.cachedWriteTokens),
      asInt(entry.imageCount),
      entry.imageSize ?? null,
      asNumber(entry.audioSeconds),
      asNumber(entry.costUsdEstimate),
      costSource,
      rawJson,
    );
  } catch (err) {
    console.warn('[usage-log] write failed', err?.message || err);
  }
}

/**
 * Build an aggregated usage report grouped by one of:
 * 'surface' | 'agent' | 'project' | 'model' | 'provider'.
 * Time range is inclusive on `from` and exclusive on `to`.
 */
export function listUsageGrouped(
  db,
  { from = 0, to = Number.MAX_SAFE_INTEGER, groupBy = 'surface', projectId } = {},
) {
  const col = COLUMN_FOR_GROUP[groupBy] ?? 'surface';
  const params = [from, to];
  let where = `WHERE ts >= ? AND ts < ?`;
  if (projectId) {
    where += ` AND project_id = ?`;
    params.push(projectId);
  }
  const rows = db
    .prepare(
      `SELECT ${col} AS key,
              COUNT(*) AS count,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(cached_read_tokens), 0) AS cached_read_tokens,
              COALESCE(SUM(image_count), 0) AS image_count,
              COALESCE(SUM(audio_seconds), 0) AS audio_seconds,
              COALESCE(SUM(cost_usd_estimate), 0) AS cost_usd
         FROM usage_logs
         ${where}
        GROUP BY ${col}
        ORDER BY cost_usd DESC, count DESC`,
    )
    .all(...params);
  const total = db
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(image_count), 0) AS image_count,
              COALESCE(SUM(cost_usd_estimate), 0) AS cost_usd
         FROM usage_logs
         ${where}`,
    )
    .get(...params);
  return {
    rows: rows.map((r) => ({
      key: r.key ?? '(none)',
      count: Number(r.count),
      inputTokens: Number(r.input_tokens || 0),
      outputTokens: Number(r.output_tokens || 0),
      cachedReadTokens: Number(r.cached_read_tokens || 0),
      imageCount: Number(r.image_count || 0),
      audioSeconds: Number(r.audio_seconds || 0),
      costUsd: Number(r.cost_usd || 0),
    })),
    total: {
      count: Number(total?.count || 0),
      inputTokens: Number(total?.input_tokens || 0),
      outputTokens: Number(total?.output_tokens || 0),
      imageCount: Number(total?.image_count || 0),
      costUsd: Number(total?.cost_usd || 0),
    },
  };
}

/**
 * Per-day cost rollup for the last N days plus surface/provider splits.
 */
export function summarizeUsage(db, period = '30d') {
  const now = Date.now();
  const days = period === '7d' ? 7 : period === '30d' ? 30 : null;
  const from =
    days == null ? 0 : now - days * 24 * 60 * 60 * 1000;
  const dailyRows = db
    .prepare(
      `SELECT
         strftime('%Y-%m-%d', ts / 1000, 'unixepoch') AS date,
         COUNT(*) AS calls,
         COALESCE(SUM(cost_usd_estimate), 0) AS cost_usd
       FROM usage_logs
       WHERE ts >= ?
       GROUP BY date
       ORDER BY date ASC`,
    )
    .all(from);
  const surfaceRows = db
    .prepare(
      `SELECT surface AS key,
              COUNT(*) AS count,
              COALESCE(SUM(cost_usd_estimate), 0) AS cost_usd
         FROM usage_logs
         WHERE ts >= ?
         GROUP BY surface`,
    )
    .all(from);
  const providerRows = db
    .prepare(
      `SELECT provider AS key,
              COUNT(*) AS count,
              COALESCE(SUM(cost_usd_estimate), 0) AS cost_usd
         FROM usage_logs
         WHERE ts >= ?
         GROUP BY provider`,
    )
    .all(from);
  const total = db
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(cost_usd_estimate), 0) AS cost_usd
         FROM usage_logs
         WHERE ts >= ?`,
    )
    .get(from);
  return {
    period,
    from,
    to: now,
    daily: dailyRows.map((r) => ({
      date: r.date,
      calls: Number(r.calls),
      costUsd: Number(r.cost_usd || 0),
    })),
    bySurface: rowsToMap(surfaceRows),
    byProvider: rowsToMap(providerRows),
    total: {
      count: Number(total?.count || 0),
      costUsd: Number(total?.cost_usd || 0),
    },
  };
}

/**
 * Recent calls for the table view. Returns at most `limit` rows.
 */
export function listUsageRecent(db, limit = 50) {
  const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 500);
  return db
    .prepare(
      `SELECT id, ts, project_id AS projectId, conversation_id AS conversationId,
              message_id AS messageId, agent_id AS agentId,
              surface, provider, model,
              input_tokens AS inputTokens,
              output_tokens AS outputTokens,
              cached_read_tokens AS cachedReadTokens,
              cached_write_tokens AS cachedWriteTokens,
              image_count AS imageCount,
              image_size AS imageSize,
              audio_seconds AS audioSeconds,
              cost_usd_estimate AS costUsd,
              cost_source AS costSource
         FROM usage_logs
         ORDER BY ts DESC
         LIMIT ?`,
    )
    .all(safeLimit)
    .map((r) => ({
      ...r,
      ts: Number(r.ts),
      inputTokens: numberOrNull(r.inputTokens),
      outputTokens: numberOrNull(r.outputTokens),
      cachedReadTokens: numberOrNull(r.cachedReadTokens),
      cachedWriteTokens: numberOrNull(r.cachedWriteTokens),
      imageCount: numberOrNull(r.imageCount),
      audioSeconds: numberOrNull(r.audioSeconds),
      costUsd: numberOrNull(r.costUsd),
    }));
}

/**
 * Delete usage rows older than `before` (ms epoch). Pass undefined to
 * clear the entire history. Returns the number of rows deleted.
 */
export function deleteUsage(db, before) {
  if (typeof before === 'number' && Number.isFinite(before)) {
    const result = db
      .prepare(`DELETE FROM usage_logs WHERE ts < ?`)
      .run(before);
    return Number(result?.changes || 0);
  }
  const result = db.prepare(`DELETE FROM usage_logs`).run();
  return Number(result?.changes || 0);
}

const COLUMN_FOR_GROUP = {
  surface: 'surface',
  agent: "COALESCE(agent_id, '(none)')",
  project: "COALESCE(project_id, '(none)')",
  model: 'model',
  provider: 'provider',
};

function asInt(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function asNumber(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function numberOrNull(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeStringify(value, maxLen) {
  try {
    const s = JSON.stringify(value);
    if (typeof s !== 'string') return null;
    return s.length > maxLen ? s.slice(0, maxLen) : s;
  } catch {
    return null;
  }
}

function rowsToMap(rows) {
  const out = {};
  for (const r of rows) {
    const key = r.key || '(none)';
    out[key] = {
      count: Number(r.count || 0),
      costUsd: Number(r.cost_usd || 0),
    };
  }
  return out;
}
