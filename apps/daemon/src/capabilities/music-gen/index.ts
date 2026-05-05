// @ts-nocheck
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  AUDIO_DURATIONS_SEC,
  findMediaModel,
  findProvider,
  modelsForSurface,
} from '../../media-models.js';
import { resolveProviderConfig } from '../../media-config.js';
import { ensureProject, kindFor, mimeFor, sanitizeName } from '../../projects.js';
import { createCapabilityTracer } from '../../orchestrator/tracer.js';
import { createPassThroughQuotaChecker } from '../../orchestrator/quota.js';
import {
  StubProviderDisabledError,
  autoOutputName,
  renderStub,
  stubsAllowed,
} from '../media-utils.js';

const MUSIC_GEN_CAPABILITY_ID = 'music-gen';

// MusicGenKind → audio sub-kind used in media-models
const KIND_TO_AUDIO_KIND = {
  music: 'music',
  bed: 'music',       // background bed music
  voiceover: 'speech',
  sfx: 'sfx',
};

function defaultModelFor(kind) {
  const audioKind = KIND_TO_AUDIO_KIND[kind] ?? 'music';
  const models = modelsForSurface('audio', audioKind);
  return models.find((m) => m.default)?.id ?? models[0]?.id ?? 'suno-v5';
}

function clampDuration(duration) {
  if (typeof duration !== 'number' || !Number.isFinite(duration)) {
    return AUDIO_DURATIONS_SEC[2] ?? 30;
  }
  if (AUDIO_DURATIONS_SEC.includes(duration)) return duration;
  let best = AUDIO_DURATIONS_SEC[0];
  let bestDiff = Math.abs(duration - best);
  for (const a of AUDIO_DURATIONS_SEC) {
    const d = Math.abs(duration - a);
    if (d < bestDiff) { best = a; bestDiff = d; }
  }
  return best;
}

/**
 * Generate audio (music/bed/voiceover/sfx) and write it into the project's
 * files directory. Mirrors the shape of generateImageCapability() so the
 * server dispatch and the orchestrator runner can treat both capabilities
 * uniformly.
 *
 * All music providers (suno, udio, google/lyria) are currently integrated:false
 * in media-models.ts, so every path falls through to the stub renderer.
 * Real integrations land in Phase 4+.
 */
export async function generateMusicCapability(args) {
  const {
    projectRoot,
    projectsRoot,
    projectId,
    model,
    prompt,
    kind = 'music',   // MusicGenKind
    durationSec,
    voiceId,
    language,
    output,
    db,
    runId,
    scenarioId,
  } = args;

  if (!projectRoot) throw new Error('projectRoot required');
  if (!projectsRoot) throw new Error('projectsRoot required');
  if (typeof projectId !== 'string' || !projectId) throw new Error('projectId required');

  const audioKind = KIND_TO_AUDIO_KIND[kind] ?? 'music';
  const resolvedModel =
    typeof model === 'string' && model ? model : defaultModelFor(kind);

  const def = findMediaModel(resolvedModel);
  if (!def) {
    throw new Error(
      `unknown model: ${resolvedModel}. Pass --model from the registered list (see /api/media/models).`,
    );
  }

  const allowed = modelsForSurface('audio', audioKind);
  if (!allowed.some((m) => m.id === resolvedModel)) {
    const ids = allowed.map((m) => m.id).join(', ');
    throw new Error(
      `model "${resolvedModel}" is not registered for audio·${audioKind}. Allowed: ${ids}.`,
    );
  }

  const clampedDuration = clampDuration(durationSec);
  const dir = await ensureProject(projectsRoot, projectId);
  const safeOut = sanitizeName(
    output || autoOutputName('audio', resolvedModel, audioKind),
  );
  const target = path.join(dir, safeOut);
  await mkdir(path.dirname(target), { recursive: true });

  const provider = findProvider(def.provider);
  const ctx = {
    surface: 'audio',
    model: resolvedModel,
    modelDef: def,
    provider,
    prompt: prompt || '',
    audioKind,
    duration: clampedDuration,
    voice: voiceId || '',
    language: language || '',
  };

  await resolveProviderConfig(projectRoot, def.provider);

  await createPassThroughQuotaChecker().check({
    scenarioId: scenarioId || 'legacy-media',
    capabilityId: MUSIC_GEN_CAPABILITY_ID,
    estimatedUnits: clampedDuration,
  });

  const trace = db
    ? createCapabilityTracer(db).startInvocation({
        runId: runId || `media-${Date.now()}`,
        scenarioId: scenarioId || 'legacy-media',
        capabilityId: MUSIC_GEN_CAPABILITY_ID,
        inputHash: `${def.provider}:${resolvedModel}:${audioKind}:${clampedDuration}`,
      })
    : null;

  let bytes;
  let providerNote;
  let suggestedExt;
  let providerError = null;
  let usedStubFallback = false;
  let intentionalStub = false;
  let status = 'success';
  let errorMessage;

  try {
    // No real music-gen providers integrated yet (suno/udio/google lyria).
    // Speech providers (openai TTS, minimax TTS, fishaudio) remain in the
    // legacy media.ts dispatch and are NOT routed through this capability;
    // this capability owns only the music/bed/sfx audioKinds.
    if (!stubsAllowed()) {
      throw new StubProviderDisabledError(resolvedModel);
    }
    const result = await renderStub(ctx, safeOut);
    bytes = result.bytes;
    providerNote = result.providerNote;
    intentionalStub = true;
  } catch (err) {
    if (err instanceof StubProviderDisabledError) {
      status = 'error';
      errorMessage = err.message;
      trace?.finish({
        status,
        provider: def.provider,
        costUnits: 0,
        durationMs: undefined,
        cached: false,
        errorMessage,
      });
      throw err;
    }
    if (!stubsAllowed()) {
      status = 'error';
      errorMessage = err?.message ?? String(err);
      trace?.finish({ status, provider: def.provider, costUnits: 0, cached: false, errorMessage });
      throw err;
    }
    const stub = await renderStub(ctx, safeOut);
    bytes = stub.bytes;
    const msg = err?.message ?? String(err);
    providerNote = `[${def.provider} error → stub] ${msg}`;
    providerError = msg;
    usedStubFallback = true;
    try {
      console.error(`[media] ${def.provider}/audio/${resolvedModel} failed: ${msg}`);
    } catch { /* best-effort */ }
  }

  if (intentionalStub || usedStubFallback) {
    providerNote = `[stub] ${providerNote}`;
  }

  let finalOut = safeOut;
  if (suggestedExt) {
    const dot = safeOut.lastIndexOf('.');
    const stem = dot > 0 ? safeOut.slice(0, dot) : safeOut;
    finalOut = `${stem}${suggestedExt}`;
  }
  const finalTarget = path.join(dir, finalOut);
  await writeFile(finalTarget, bytes);
  const st = await stat(finalTarget);

  trace?.finish({
    status,
    provider: def.provider,
    costUnits: intentionalStub || usedStubFallback ? 0 : clampedDuration,
    cached: false,
    errorMessage,
  });

  return {
    name: finalOut,
    size: st.size,
    mtime: st.mtimeMs,
    kind: kindFor(finalOut),
    mime: mimeFor(finalOut),
    model: resolvedModel,
    surface: 'audio',
    audioKind,
    durationSec: clampedDuration,
    providerNote,
    providerId: def.provider,
    providerError,
    usedStubFallback,
    intentionalStub,
    warnings: [],
  };
}
