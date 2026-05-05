// @ts-nocheck
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { findMediaModel, findProvider, modelsForSurface } from '../../media-models.js';
import { resolveProviderConfig } from '../../media-config.js';
import { ensureProject, kindFor, mimeFor, sanitizeName } from '../../projects.js';
import { createCapabilityTracer } from '../../orchestrator/tracer.js';
import { createPassThroughQuotaChecker } from '../../orchestrator/quota.js';
import {
  StubProviderDisabledError,
  autoOutputName,
  defaultAspectFor,
  renderStub,
  resolveProjectImage,
  stubsAllowed,
} from '../media-utils.js';
import { renderOpenAIImage } from './providers/openai.js';
import { renderVolcengineImage } from './providers/volcengine.js';
import { renderGrokImage } from './providers/grok.js';

const IMAGE_CAPABILITY_ID = 'image-gen';

export async function generateImageCapability(args) {
  const {
    projectRoot,
    projectsRoot,
    projectId,
    model,
    prompt,
    output,
    aspect,
    image,
    db,
    runId,
    scenarioId,
  } = args;

  if (!projectRoot) throw new Error('projectRoot required');
  if (!projectsRoot) throw new Error('projectsRoot required');
  if (typeof projectId !== 'string' || !projectId) {
    throw new Error('projectId required');
  }
  if (typeof model !== 'string' || !model) {
    throw new Error('model required');
  }

  const def = findMediaModel(model);
  if (!def) {
    throw new Error(
      `unknown model: ${model}. Pass --model from the registered list (see /api/media/models).`,
    );
  }
  const allowed = modelsForSurface('image');
  if (!allowed.some((m) => m.id === model)) {
    const ids = allowed.map((m) => m.id).join(', ');
    throw new Error(
      `model "${model}" is not registered for surface "image". Allowed: ${ids}.`,
    );
  }

  const dir = await ensureProject(projectsRoot, projectId);
  const safeOut = sanitizeName(output || autoOutputName('image', model));
  const target = path.join(dir, safeOut);
  await mkdir(path.dirname(target), { recursive: true });
  const imageRef = await resolveProjectImage(image, dir);
  const provider = findProvider(def.provider);
  const resolvedAspect = aspect || defaultAspectFor('image');
  const ctx = {
    surface: 'image',
    model,
    modelDef: def,
    provider,
    prompt: prompt || '',
    aspect: resolvedAspect,
    imageRef,
  };
  const credentials = await resolveProviderConfig(projectRoot, def.provider);

  await createPassThroughQuotaChecker().check({
    scenarioId: scenarioId || 'legacy-media',
    capabilityId: IMAGE_CAPABILITY_ID,
    estimatedUnits: 1,
  });

  const trace = db
    ? createCapabilityTracer(db).startInvocation({
        runId: runId || `media-${Date.now()}`,
        scenarioId: scenarioId || 'legacy-media',
        capabilityId: IMAGE_CAPABILITY_ID,
        inputHash: `${def.provider}:${model}:${resolvedAspect}`,
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
    if (def.provider === 'openai') {
      const result = await renderOpenAIImage(ctx, credentials);
      bytes = result.bytes;
      providerNote = result.providerNote;
      suggestedExt = result.suggestedExt;
    } else if (def.provider === 'volcengine') {
      const result = await renderVolcengineImage(ctx, credentials);
      bytes = result.bytes;
      providerNote = result.providerNote;
      suggestedExt = result.suggestedExt;
    } else if (def.provider === 'grok') {
      const result = await renderGrokImage(ctx, credentials);
      bytes = result.bytes;
      providerNote = result.providerNote;
      suggestedExt = result.suggestedExt;
    } else {
      if (!stubsAllowed()) {
        throw new StubProviderDisabledError(model);
      }
      const result = await renderStub(ctx, safeOut);
      bytes = result.bytes;
      providerNote = result.providerNote;
      intentionalStub = true;
    }
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
      errorMessage = err && err.message ? err.message : String(err);
      trace?.finish({
        status,
        provider: def.provider,
        costUnits: 0,
        cached: false,
        errorMessage,
      });
      throw err;
    }
    const stub = await renderStub(ctx, safeOut);
    bytes = stub.bytes;
    const msg = err && err.message ? err.message : String(err);
    providerNote = `[${def.provider} error → stub] ${msg}`;
    providerError = msg;
    usedStubFallback = true;
    try {
      console.error(`[media] ${def.provider}/image/${model} failed: ${msg}`);
    } catch {
      // best-effort logging only
    }
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
  const meta = {
    name: finalOut,
    size: st.size,
    mtime: st.mtimeMs,
    kind: kindFor(finalOut),
    mime: mimeFor(finalOut),
    model,
    surface: 'image',
    providerNote,
    providerId: def.provider,
    providerError,
    usedStubFallback,
    intentionalStub,
    warnings: [],
  };

  trace?.finish({
    status,
    provider: def.provider,
    costUnits: intentionalStub || usedStubFallback ? 0 : 1,
    cached: false,
    errorMessage,
  });

  return meta;
}

export { openaiSizeFor } from './providers/openai.js';
