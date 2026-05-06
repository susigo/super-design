import type {
  DaemonScenario,
  DaemonScenarioContext,
  ScenarioManifest,
  ScenarioRunEventType,
  ScenarioRunInput,
} from '../../orchestrator/runner.js';
import {
  buildHeroImagePrompt,
  extractPageTitle,
  extractPageSections,
} from './prompt-templates.js';
import { assembleWebPageHtml } from './post-process.js';

const manifest: ScenarioManifest = {
  id: 'frontend-design',
  version: '0.1.0',
  capabilities: [
    { id: 'image-gen', version: '^0', required: false },
  ],
};

const SCENARIO_ID = 'frontend-design';

async function* run(
  input: ScenarioRunInput,
  ctx: DaemonScenarioContext,
): AsyncGenerator<ScenarioRunEventType> {
  const title = extractPageTitle(input.prompt);
  const sections = extractPageSections(input.prompt);
  yield { type: 'message', role: 'system', content: `Generating web page: "${title}"` };

  // ── 1. Optionally generate hero image ───────────────────────────────────
  const imageGen = ctx.capabilities.get<
    { prompt: string; size?: string },
    { filePath: string; mimeType: string; width: number; height: number }
  >('image-gen');

  let heroImageAbsPath: string | undefined;
  if (imageGen) {
    const imgTraceStart = ctx.tracer.startInvocation({
      runId: input.runId,
      scenarioId: SCENARIO_ID,
      capabilityId: 'image-gen',
      inputHash: `hero:${input.prompt.slice(0, 80)}`,
    });
    yield { type: 'capability:start', capabilityId: 'image-gen', traceId: imgTraceStart.traceId };
    try {
      const imgResult = await imageGen.invoke({
        runId: input.runId,
        scenarioId: SCENARIO_ID,
        input: { prompt: buildHeroImagePrompt(input.prompt), size: '1536x1024' },
      });
      heroImageAbsPath = imgResult.output.filePath;
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
      // image-gen is optional — continue without hero image
    }
  }

  // ── 2. Assemble web page HTML ───────────────────────────────────────────
  const html = assembleWebPageHtml({
    title,
    prompt: input.prompt,
    sections,
    ...(heroImageAbsPath !== undefined ? { heroImageAbsPath } : {}),
    projectDir: ctx.projectDir,
  });

  const htmlPath = await ctx.writeArtifact('design.html', html);
  void htmlPath;

  yield { type: 'artifact', path: 'design.html', mimeType: 'text/html' };
  yield { type: 'done' };
}

export const frontendDesignScenario: DaemonScenario = { manifest, run };
