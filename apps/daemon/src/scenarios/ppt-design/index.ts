import type {
  DaemonScenario,
  DaemonScenarioContext,
  ScenarioManifest,
  ScenarioRunEventType,
  ScenarioRunInput,
} from '../../orchestrator/runner.js';
import {
  buildBackgroundMusicPrompt,
  buildCoverImagePrompt,
  extractTitle,
} from './prompt-templates.js';
import { assemblePptHtml } from './post-process.js';

const manifest: ScenarioManifest = {
  id: 'ppt-design',
  version: '0.1.0',
  capabilities: [
    { id: 'image-gen', version: '^0', required: true },
    { id: 'music-gen', version: '^0', required: false },
  ],
};

const SCENARIO_ID = 'ppt-design';

async function* run(
  input: ScenarioRunInput,
  ctx: DaemonScenarioContext,
): AsyncGenerator<ScenarioRunEventType> {
  const imageGen = ctx.capabilities.get<
    { prompt: string; size?: string },
    { filePath: string; mimeType: string; width: number; height: number }
  >('image-gen');

  if (!imageGen) {
    yield { type: 'error', message: 'image-gen capability required but not available' };
    return;
  }

  const title = extractTitle(input.prompt);
  yield { type: 'message', role: 'system', content: `Generating presentation: "${title}"` };

  // ── 1. Generate cover image ──────────────────────────────────────────────
  const imgTraceStart = ctx.tracer.startInvocation({
    runId: input.runId,
    scenarioId: SCENARIO_ID,
    capabilityId: 'image-gen',
    inputHash: `cover:${input.prompt.slice(0, 80)}`,
  });
  yield { type: 'capability:start', capabilityId: 'image-gen', traceId: imgTraceStart.traceId };

  let coverImageAbsPath: string | undefined;
  try {
    const imgResult = await imageGen.invoke({
      runId: input.runId,
      scenarioId: SCENARIO_ID,
      input: { prompt: buildCoverImagePrompt(input.prompt), size: '1536x1024' },
    });
    coverImageAbsPath = imgResult.output.filePath;
    imgTraceStart.finish({
      status: 'success',
      provider: imgResult.cost.provider,
      costUnits: imgResult.cost.units,
      ...(imgResult.cost.usd !== undefined ? { costUsd: imgResult.cost.usd } : {}),
      cached: imgResult.cached,
    });
    yield { type: 'capability:end', capabilityId: 'image-gen', traceId: imgTraceStart.traceId, status: 'success' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    imgTraceStart.finish({ status: 'error', errorMessage: msg });
    yield { type: 'capability:end', capabilityId: 'image-gen', traceId: imgTraceStart.traceId, status: 'error', errorMessage: msg };
    // image-gen is required
    yield { type: 'error', message: `cover image generation failed: ${msg}` };
    return;
  }

  // ── 2. Optionally generate background music ──────────────────────────────
  const musicGen = ctx.capabilities.get<
    { prompt: string; kind?: string; durationSec?: number },
    { filePath: string; mimeType: string; durationSec: number }
  >('music-gen');

  let musicAbsPath: string | undefined;
  if (musicGen) {
    const musicTraceStart = ctx.tracer.startInvocation({
      runId: input.runId,
      scenarioId: SCENARIO_ID,
      capabilityId: 'music-gen',
      inputHash: `bg-music:${input.prompt.slice(0, 80)}`,
    });
    yield { type: 'capability:start', capabilityId: 'music-gen', traceId: musicTraceStart.traceId };
    try {
      const musicResult = await musicGen.invoke({
        runId: input.runId,
        scenarioId: SCENARIO_ID,
        input: {
          prompt: buildBackgroundMusicPrompt(input.prompt),
          kind: 'bed',
          durationSec: 30,
        },
      });
      musicAbsPath = musicResult.output.filePath;
      musicTraceStart.finish({
        status: 'success',
        provider: musicResult.cost.provider,
        costUnits: musicResult.cost.units,
        cached: musicResult.cached,
      });
      yield { type: 'capability:end', capabilityId: 'music-gen', traceId: musicTraceStart.traceId, status: 'success' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      musicTraceStart.finish({ status: 'error', errorMessage: msg });
      yield { type: 'capability:end', capabilityId: 'music-gen', traceId: musicTraceStart.traceId, status: 'error', errorMessage: msg };
      // music-gen is optional — continue without audio
    }
  }

  // ── 3. Assemble presentation HTML ───────────────────────────────────────
  const html = assemblePptHtml({
    title,
    prompt: input.prompt,
    ...(coverImageAbsPath !== undefined ? { coverImageAbsPath } : {}),
    ...(musicAbsPath !== undefined ? { musicAbsPath } : {}),
    projectDir: ctx.projectDir,
  });

  const htmlPath = await ctx.writeArtifact('presentation.html', html);
  void htmlPath;

  yield { type: 'artifact', path: 'presentation.html', mimeType: 'text/html' };
  yield { type: 'done' };
}

export const pptDesignScenario: DaemonScenario = { manifest, run };
