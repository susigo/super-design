// @ts-nocheck
import express from 'express';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import fs from 'node:fs';
import { composeSystemPrompt } from '../prompts/system.js';
import { createCommandInvocation } from '@open-design/platform';
import {
  getAgentDef,
  isKnownModel,
  resolveAgentBin,
  sanitizeCustomModel,
} from '../agents/index.js';
import { listSkills } from '../skills.js';
import { listDesignSystems, readDesignSystem } from '../resources/design-systems.js';
import { attachAcpSession } from '../agents/acp.js';
import { attachPiRpcSession } from '../agents/pi-rpc.js';
import { createClaudeStreamHandler } from '../agents/claude-stream.js';
import { createCopilotStreamHandler } from '../agents/copilot-stream.js';
import { createJsonEventStreamHandler } from '../agents/json-event-stream.js';
import { getProject, getTemplate } from '../db.js';
import { ensureProject, listFiles } from '../projects/index.js';
import { loadCraftSections } from '../resources/craft.js';
import { writeUsageLog } from '../billing/usage-log.js';
import { textPriceFor } from '../billing/pricing.js';
import {
  createSseErrorPayload,
  createSseResponse,
  redactAuthTokens,
  sendApiError,
  validateExternalApiBaseUrl,
} from './helpers.js';
import { normalizeCommentAttachments, renderCommentAttachmentHint } from '../project-status/comment-helpers.js';

export function createChatRouter(ctx): import("express").Router {
  const router = express.Router();
  const {
    db,
    port,
    projectRoot,
    projectsDir,
    skillsDir,
    designSystemRoots,
    craftDir,
    odBin,
    design,
    scenarioRunner,
    pptDesignScenario,
    frontendDesignScenario,
  } = ctx;

  // DESIGN_SYSTEMS_DIR is the first element of designSystemRoots (the built-in one)
  const DESIGN_SYSTEMS_DIR = designSystemRoots[0];

  const UPLOAD_DIR = path.join(tmpdir(), 'od-uploads');

  /**
   * Execute a DaemonScenario and map its ScenarioRunEvents to the SSE stream
   * of the given run. Called from startChatRun when skill.scenario matches a
   * registered technical scenario id.
   */
  async function runScenarioChatRun({ run, send, finish, scenario, input, projectCtx }) {
    run.status = 'running';
    run.updatedAt = Date.now();
    send('start', {
      runId: run.id,
      agentId: null,
      bin: null,
      streamFormat: 'scenario',
      projectId: projectCtx.projectId || null,
      cwd: projectCtx.projectDir,
    });
    try {
      for await (const event of scenarioRunner.run(scenario, input, projectCtx)) {
        switch (event.type) {
          case 'message':
            send('text-delta', { delta: event.content + '\n' });
            break;
          case 'capability:start':
            send('text-delta', { delta: `[${event.capabilityId}] starting…\n` });
            break;
          case 'capability:end':
            send('text-delta', {
              delta: event.status === 'success'
                ? `[${event.capabilityId}] done\n`
                : `[${event.capabilityId}] error: ${event.errorMessage ?? 'unknown'}\n`,
            });
            break;
          case 'artifact':
            send('artifact', { path: event.path, mimeType: event.mimeType });
            break;
          case 'error':
            send('error', { message: event.message });
            finish('failed', 1);
            return;
          case 'done':
            finish('done', 0);
            return;
        }
      }
      finish('done', 0);
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      send('error', { message: msg });
      finish('failed', 1);
    }
  }

  const composeDaemonSystemPrompt = async ({
    projectId,
    skillId,
    designSystemId,
  }) => {
    const project =
      typeof projectId === 'string' && projectId
        ? getProject(db, projectId)
        : null;
    const effectiveSkillId =
      typeof skillId === 'string' && skillId ? skillId : project?.skillId;
    const effectiveDesignSystemId =
      typeof designSystemId === 'string' && designSystemId
        ? designSystemId
        : project?.designSystemId;
    const metadata = project?.metadata;

    let skillBody;
    let skillName;
    let skillMode;
    let skillCraftRequires = [];
    if (effectiveSkillId) {
      const skill = (await listSkills(skillsDir)).find(
        (s) => s.id === effectiveSkillId,
      );
      if (skill) {
        skillBody = skill.body;
        skillName = skill.name;
        skillMode = skill.mode;
        if (Array.isArray(skill.craftRequires))
          skillCraftRequires = skill.craftRequires;
      }
    }

    let craftBody;
    let craftSections;
    if (skillCraftRequires.length > 0) {
      const loaded = await loadCraftSections(craftDir, skillCraftRequires);
      if (loaded.body) {
        craftBody = loaded.body;
        craftSections = loaded.sections;
      }
    }

    let designSystemBody;
    let designSystemTitle;
    if (effectiveDesignSystemId) {
      const systems = await listDesignSystems(designSystemRoots);
      const summary = systems.find((s) => s.id === effectiveDesignSystemId);
      designSystemTitle = summary?.title;
      designSystemBody =
        (await readDesignSystem(designSystemRoots, effectiveDesignSystemId)) ??
        undefined;
    }

    const template =
      metadata?.kind === 'template' && typeof metadata.templateId === 'string'
        ? (getTemplate(db, metadata.templateId) ?? undefined)
        : undefined;

    return composeSystemPrompt({
      skillBody,
      skillName,
      skillMode,
      designSystemBody,
      designSystemTitle,
      craftBody,
      craftSections,
      metadata,
      template,
    });
  };

  const startChatRun = async (chatBody, run) => {
    /** @type {Partial<import('@open-design/contracts').ChatRequest> & { imagePaths?: string[] }} */
    chatBody = chatBody || {};
    const {
      agentId,
      message,
      systemPrompt,
      imagePaths = [],
      projectId,
      conversationId,
      assistantMessageId,
      clientRequestId,
      skillId,
      designSystemId,
      attachments = [],
      commentAttachments = [],
      model,
      reasoning,
    } = chatBody;
    if (typeof projectId === 'string' && projectId) run.projectId = projectId;
    if (typeof conversationId === 'string' && conversationId)
      run.conversationId = conversationId;
    if (typeof assistantMessageId === 'string' && assistantMessageId)
      run.assistantMessageId = assistantMessageId;
    if (typeof clientRequestId === 'string' && clientRequestId)
      run.clientRequestId = clientRequestId;
    if (typeof agentId === 'string' && agentId) run.agentId = agentId;
    const def = getAgentDef(agentId);
    if (!def)
      return design.runs.fail(
        run,
        'AGENT_UNAVAILABLE',
        `unknown agent: ${agentId}`,
      );
    if (!def.bin)
      return design.runs.fail(run, 'AGENT_UNAVAILABLE', 'agent has no binary');
    const safeCommentAttachments =
      normalizeCommentAttachments(commentAttachments);
    if (
      (typeof message !== 'string' || !message.trim()) &&
      safeCommentAttachments.length === 0
    ) {
      return design.runs.fail(run, 'BAD_REQUEST', 'message required');
    }
    if (run.cancelRequested || design.runs.isTerminal(run.status)) return;

    // Resolve the project working directory (creating the folder if it
    // doesn't exist yet). Without one we don't pass cwd to spawn — the
    // agent then runs in whatever inherited dir, which still lets API
    // mode work but loses file-tool addressability.
    let cwd = null;
    let existingProjectFiles = [];
    if (typeof projectId === 'string' && projectId) {
      try {
        cwd = await ensureProject(projectsDir, projectId);
        existingProjectFiles = await listFiles(projectsDir, projectId);
      } catch {
        cwd = null;
      }
    }
    if (run.cancelRequested || design.runs.isTerminal(run.status)) return;

    // Sanitise supplied image paths: must live under UPLOAD_DIR.
    const safeImages = imagePaths.filter((p) => {
      const resolved = path.resolve(p);
      return (
        resolved.startsWith(UPLOAD_DIR + path.sep) && fs.existsSync(resolved)
      );
    });

    // Project-scoped attachments: project-relative paths inside cwd. Each
    // is run through the same path-traversal guard the file CRUD endpoints
    // use, then existence-checked. Whatever survives shows up as an
    // explicit list at the bottom of the user message so the agent knows
    // to Read it.
    const safeAttachments = cwd
      ? (Array.isArray(attachments) ? attachments : [])
          .filter((p) => typeof p === 'string' && p.length > 0)
          .filter((p) => {
            try {
              const abs = path.resolve(cwd, p);
              return (
                (abs === cwd || abs.startsWith(cwd + path.sep)) &&
                fs.existsSync(abs)
              );
            } catch {
              return false;
            }
          })
      : [];

    // Local code agents don't accept a separate "system" channel the way the
    // Messages API does — we fold the skill + design-system prompt into the
    // user message. The <artifact> wrapping instruction comes from
    // systemPrompt. We also stitch in the cwd hint so the agent knows
    // where its file tools should write, and the attachment list so it
    // doesn't have to guess what the user just dropped in.
    // Also ship the current file listing so the agent can pick a unique
    // filename instead of clobbering a previous artifact.
    const filesListBlock = existingProjectFiles.length
      ? `\nFiles already in this folder (do NOT overwrite unless the user asks; pick a fresh, descriptive name for new artifacts):\n${existingProjectFiles
          .map((f) => `- ${f.name}`)
          .join('\n')}`
      : '\nThis folder is empty. Choose a clear, descriptive filename for whatever you create.';
    const cwdHint = cwd
      ? `\n\nYour working directory: ${cwd}\nWrite project files relative to it (e.g. \`index.html\`, \`assets/x.png\`). The user can browse those files in real time.${filesListBlock}`
      : '';
    const attachmentHint = safeAttachments.length
      ? `\n\nAttached project files: ${safeAttachments.map((p) => `\`${p}\``).join(', ')}`
      : '';
    const commentHint = renderCommentAttachmentHint(safeCommentAttachments);
    const daemonSystemPrompt = await composeDaemonSystemPrompt({
      projectId,
      skillId,
      designSystemId,
    });
    const instructionPrompt = [daemonSystemPrompt, systemPrompt]
      .map((part) => (typeof part === 'string' ? part.trim() : ''))
      .filter(Boolean)
      .join('\n\n---\n\n');
    const composed = [
      instructionPrompt
        ? `# Instructions (read first)\n\n${instructionPrompt}${cwdHint}\n\n---\n`
        : cwdHint
          ? `# Instructions${cwdHint}\n\n---\n`
          : '',
      `# User request\n\n${message || '(No extra typed instruction.)'}${attachmentHint}${commentHint}`,
      safeImages.length
        ? `\n\n${safeImages.map((p) => `@${p}`).join(' ')}`
        : '',
    ].join('');

    // Skill seeds (`skills/<id>/assets/template.html`) and design-system
    // specs (`design-systems/<id>/DESIGN.md`) live outside the project cwd.
    // The composed system prompt asks the agent to Read them via absolute
    // paths in the skill-root preamble — without an explicit allowlist,
    // Claude Code blocks those reads (issue #6: "no permission to read
    // skills template"). We surface both roots so any agent that honours
    // `--add-dir` can resolve those side files.
    const extraAllowedDirs = [skillsDir, DESIGN_SYSTEMS_DIR].filter((d) =>
      fs.existsSync(d),
    );

    // ── Scenario routing (Phase 2) ─────────────────────────────────────────
    // When the resolved skill declares `od.scenario: ppt-design` in its
    // SKILL.md frontmatter, route through the capability orchestrator instead
    // of spawning the legacy code agent. This is a no-op for all existing
    // skills that carry the UI-category `scenario` value (general, engineering,
    // etc.); only skills explicitly authored with the technical scenario id
    // activate this path.
    if (typeof skillId === 'string' && skillId && cwd) {
      const allSkills = await listSkills(skillsDir).catch(() => []);
      const resolvedSkill = allSkills.find((s) => s.id === skillId);
      const scenarioMap: Record<string, typeof pptDesignScenario> = {
        'ppt-design': pptDesignScenario,
        'frontend-design': frontendDesignScenario,
      };
      const matchedScenario = resolvedSkill?.scenario ? scenarioMap[resolvedSkill.scenario] : undefined;
      if (matchedScenario) {
        await runScenarioChatRun({
          run,
          send: (event, data) => design.runs.emit(run, event, data),
          finish: (status, code) => design.runs.finish(run, status, code, null),
          scenario: matchedScenario,
          input: {
            runId: run.id,
            prompt: message || '',
            attachments: safeAttachments,
            designSystemId: typeof designSystemId === 'string' ? designSystemId : undefined,
            skillId,
          },
          projectCtx: {
            projectRoot,
            projectsRoot: projectsDir,
            projectId: typeof projectId === 'string' ? projectId : '',
            projectDir: cwd,
            db,
          },
        });
        return;
      }
    }

    // Per-agent model + reasoning the user picked in the model menu.
    // Trust the value when it matches the most recent /api/agents listing
    // (live or fallback). Otherwise allow it through if it passes a
    // permissive sanitizer — that's the path for user-typed custom model
    // ids the CLI's listing didn't surface yet.
    const safeModel =
      typeof model === 'string'
        ? isKnownModel(def, model)
          ? model
          : sanitizeCustomModel(model)
        : null;
    const safeReasoning =
      typeof reasoning === 'string' && Array.isArray(def.reasoningOptions)
        ? (def.reasoningOptions.find((r) => r.id === reasoning)?.id ?? null)
        : null;
    const agentOptions = { model: safeModel, reasoning: safeReasoning };

    const resolvedBin = resolveAgentBin(agentId);

    // If detection can't find the binary, surface a friendly SSE error
    // pointing at /api/agents instead of silently falling back to
    // spawn(def.bin) — that fallback re-introduces the exact ENOENT symptom
    // from issue #10.
    if (!resolvedBin) {
      design.runs.emit(
        run,
        'error',
        createSseErrorPayload(
          'AGENT_UNAVAILABLE',
          `Agent "${def.name}" (\`${def.bin}\`) is not installed or not on PATH. ` +
            'Install it and refresh the agent list (GET /api/agents) before retrying.',
          { retryable: true },
        ),
      );
      return design.runs.finish(run, 'failed', 1, null);
    }

    const args = def.buildArgs(
      composed,
      safeImages,
      extraAllowedDirs,
      agentOptions,
      { cwd },
    );
    const send = (event, data) => design.runs.emit(run, event, data);

    const odMediaEnv = {
      OD_BIN: odBin,
      OD_DAEMON_URL: `http://127.0.0.1:${port}`,
      ...(typeof projectId === 'string' && projectId && cwd
        ? {
            OD_PROJECT_ID: projectId,
            OD_PROJECT_DIR: cwd,
          }
        : {}),
    };

    if (run.cancelRequested || design.runs.isTerminal(run.status)) return;

    run.status = 'running';
    run.updatedAt = Date.now();
    send('start', {
      runId: run.id,
      agentId,
      bin: resolvedBin,
      streamFormat: def.streamFormat ?? 'plain',
      projectId: typeof projectId === 'string' ? projectId : null,
      cwd,
      model: safeModel,
      reasoning: safeReasoning,
    });

    let child;
    let acpSession = null;
    try {
      // Prompt delivery via stdin is now the universal default. This bypasses
      // both the cmd.exe 8KB limit and the CreateProcess 32KB limit.
      const stdinMode =
        def.promptViaStdin || def.streamFormat === 'acp-json-rpc'
          ? 'pipe'
          : 'ignore';
      const env = { ...process.env, ...odMediaEnv };
      const invocation = createCommandInvocation({
        command: resolvedBin,
        args,
        env,
      });
      child = spawn(invocation.command, invocation.args, {
        env,
        stdio: [stdinMode, 'pipe', 'pipe'],
        cwd: cwd || undefined,
        shell: false,
        // Required when invocation wraps a Windows .cmd/.bat shim through
        // cmd.exe; without this, Node re-escapes the inner command line and
        // breaks paths containing spaces (issue #315).
        windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      });
      run.child = child;
      if (def.promptViaStdin && child.stdin && def.streamFormat !== 'pi-rpc') {
        // EPIPE from a fast-exiting CLI (bad auth, missing model, exit on
        // launch) would otherwise surface as an unhandled stream error and
        // crash the daemon. Swallow it — the regular exit/close handlers
        // below already route the underlying failure to SSE via stderr.
        child.stdin.on('error', (err) => {
          if (err.code !== 'EPIPE') {
            send(
              'error',
              createSseErrorPayload(
                'AGENT_EXECUTION_FAILED',
                `stdin: ${err.message}`,
              ),
            );
          }
        });
        child.stdin.end(composed, 'utf8');
      }
    } catch (err) {
      design.runs.emit(
        run,
        'error',
        createSseErrorPayload(
          'AGENT_EXECUTION_FAILED',
          `spawn failed: ${err.message}`,
        ),
      );
      return design.runs.finish(run, 'failed', 1, null);
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    // Side-channel: when a stream handler emits a 'usage' event we
    // persist a row to usage_logs for transparent metering. Failures
    // never bubble; see usage-log.ts.
    const recordUsageEvent = (ev) => {
      if (!ev || ev.type !== 'usage') return;
      try {
        const usage = ev.usage || {};
        const inputTokens =
          usage.input_tokens ??
          usage.inputTokens ??
          usage.prompt_tokens ??
          null;
        const outputTokens =
          usage.output_tokens ??
          usage.outputTokens ??
          usage.completion_tokens ??
          null;
        const cachedRead =
          usage.cache_read_input_tokens ??
          usage.cachedReadInputTokens ??
          null;
        const cachedWrite =
          usage.cache_creation_input_tokens ??
          usage.cachedCreationInputTokens ??
          null;
        const providerCost = ev.costUsd;
        const hasProviderCost =
          typeof providerCost === 'number' && Number.isFinite(providerCost);
        const estimate = hasProviderCost
          ? providerCost
          : textPriceFor(safeModel, {
              inputTokens: inputTokens ?? 0,
              outputTokens: outputTokens ?? 0,
              cachedReadTokens: cachedRead ?? 0,
            });
        let costSource = 'pricing-table';
        if (hasProviderCost) costSource = 'provider';
        else if (estimate == null) costSource = 'pricing-table-missing';
        writeUsageLog(db, {
          ts: Date.now(),
          projectId: typeof projectId === 'string' ? projectId : null,
          conversationId:
            typeof conversationId === 'string' ? conversationId : null,
          messageId:
            typeof assistantMessageId === 'string'
              ? assistantMessageId
              : null,
          agentId: typeof agentId === 'string' ? agentId : null,
          surface: 'text',
          provider: agentId === 'claude' ? 'anthropic' : agentId || 'unknown',
          model: safeModel || 'unknown',
          inputTokens,
          outputTokens,
          cachedReadTokens: cachedRead,
          cachedWriteTokens: cachedWrite,
          costUsdEstimate: estimate,
          costSource,
          raw: usage,
        });
      } catch {
        // never break the stream
      }
    };
    const sendAgent = (ev) => {
      recordUsageEvent(ev);
      send('agent', ev);
    };

    // Structured streams (Claude Code) go through a line-delimited JSON
    // parser that turns stream_event objects into UI-friendly events. For
    // plain streams (most other CLIs) we forward raw chunks unchanged so
    // the browser can append them to the assistant's text buffer.
    if (def.streamFormat === 'claude-stream-json') {
      const claude = createClaudeStreamHandler(sendAgent);
      child.stdout.on('data', (chunk) => claude.feed(chunk));
      child.on('close', () => claude.flush());
    } else if (def.streamFormat === 'copilot-stream-json') {
      const copilot = createCopilotStreamHandler(sendAgent);
      child.stdout.on('data', (chunk) => copilot.feed(chunk));
      child.on('close', () => copilot.flush());
    } else if (def.streamFormat === 'pi-rpc') {
      acpSession = attachPiRpcSession({
        child,
        prompt: composed,
        cwd: cwd || projectRoot,
        model: safeModel,
        send: (event, data) => {
          if (event === 'agent') recordUsageEvent(data);
          send(event, data);
        },
      });
    } else if (def.streamFormat === 'acp-json-rpc') {
      acpSession = attachAcpSession({
        child,
        prompt: composed,
        cwd: cwd || projectRoot,
        model: safeModel,
        send: (event, data) => {
          if (event === 'agent') recordUsageEvent(data);
          send(event, data);
        },
      });
    } else if (def.streamFormat === 'json-event-stream') {
      const handler = createJsonEventStreamHandler(
        def.eventParser || def.id,
        sendAgent,
      );
      child.stdout.on('data', (chunk) => handler.feed(chunk));
      child.on('close', () => handler.flush());
    } else {
      child.stdout.on('data', (chunk) => send('stdout', { chunk }));
    }
    child.stderr.on('data', (chunk) => send('stderr', { chunk }));

    child.on('error', (err) => {
      send(
        'error',
        createSseErrorPayload('AGENT_EXECUTION_FAILED', err.message),
      );
      design.runs.finish(run, 'failed', 1, null);
    });
    child.on('close', (code, signal) => {
      if (acpSession?.hasFatalError()) {
        return design.runs.finish(run, 'failed', code ?? 1, signal ?? null);
      }
      const status = run.cancelRequested
        ? 'canceled'
        : code === 0
          ? 'succeeded'
          : 'failed';
      design.runs.finish(run, status, code, signal);
    });
  };

  router.post('/runs', (req, res) => {
    const run = design.runs.create(req.body || {});
    /** @type {import('@open-design/contracts').ChatRunCreateResponse} */
    const body = { runId: run.id };
    res.status(202).json(body);
    design.runs.start(run, () => startChatRun(req.body || {}, run));
  });

  router.get('/runs', (req, res) => {
    const { projectId, conversationId, status } = req.query;
    const runs = design.runs.list({ projectId, conversationId, status });
    /** @type {import('@open-design/contracts').ChatRunListResponse} */
    const body = { runs: runs.map(design.runs.statusBody) };
    res.json(body);
  });

  router.get('/runs/:id', (req, res) => {
    const run = design.runs.get(req.params.id);
    if (!run) return sendApiError(res, 404, 'NOT_FOUND', 'run not found');
    res.json(design.runs.statusBody(run));
  });

  router.get('/runs/:id/events', (req, res) => {
    const run = design.runs.get(req.params.id);
    if (!run) return sendApiError(res, 404, 'NOT_FOUND', 'run not found');
    design.runs.stream(run, req, res);
  });

  router.post('/runs/:id/cancel', (req, res) => {
    const run = design.runs.get(req.params.id);
    if (!run) return sendApiError(res, 404, 'NOT_FOUND', 'run not found');
    design.runs.cancel(run);
    /** @type {import('@open-design/contracts').ChatRunCancelResponse} */
    const body = { ok: true };
    res.json(body);
  });

  router.post('/chat', (req, res) => {
    const run = design.runs.create();
    design.runs.stream(run, req, res);
    design.runs.start(run, () => startChatRun(req.body || {}, run));
  });

  // ---- API Proxy (SSE) for API-compatible endpoints ------------------------
  // Browser → daemon → external API. Avoids CORS issues with third-party
  // providers. This keeps BYOK setup zero-config for local users at the cost of
  // one local streaming hop through the daemon.

  router.post('/proxy/anthropic/stream', async (req, res) => {
    /** @type {Partial<import('@open-design/contracts').ProxyStreamRequest>} */
    const proxyBody = req.body || {};
    const { baseUrl, apiKey, model, systemPrompt, messages, maxTokens } =
      proxyBody;
    if (!baseUrl || !apiKey || !model) {
      return sendApiError(
        res,
        400,
        'BAD_REQUEST',
        'baseUrl, apiKey, and model are required',
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

    const clean = baseUrl.replace(/\/+$/, '');
    const url = /\/v\d+$/.test(clean)
      ? `${clean}/messages`
      : `${clean}/v1/messages`;
    console.log(
      `[proxy:anthropic] ${req.method} ${validated.parsed.hostname} model=${model}`,
    );

    const payload = {
      model,
      max_tokens:
        typeof maxTokens === 'number' && maxTokens > 0 ? maxTokens : 8192,
      messages: Array.isArray(messages) ? messages : [],
      stream: true,
    };
    if (typeof systemPrompt === 'string' && systemPrompt) {
      payload.system = systemPrompt;
    }

    const sse = createSseResponse(res);
    let proxyInputTokens = null;
    let proxyOutputTokens = null;
    let proxyCachedRead = null;
    let proxyCachedWrite = null;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `[proxy:anthropic] upstream error: ${response.status} ${redactAuthTokens(errorText)}`,
        );
        sse.send('error', {
          message: `Upstream error: ${response.status}`,
          details: errorText,
        });
        return sse.end();
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            const event = line.slice(7).trim();
            const dataLine = lines[lines.indexOf(line) + 1];
            if (dataLine && dataLine.startsWith('data: ')) {
              try {
                const data = JSON.parse(dataLine.slice(6));
                if (event === 'message_start' && data?.message?.usage) {
                  const u = data.message.usage;
                  if (typeof u.input_tokens === 'number')
                    proxyInputTokens = u.input_tokens;
                  if (typeof u.cache_read_input_tokens === 'number')
                    proxyCachedRead = u.cache_read_input_tokens;
                  if (typeof u.cache_creation_input_tokens === 'number')
                    proxyCachedWrite = u.cache_creation_input_tokens;
                  if (typeof u.output_tokens === 'number')
                    proxyOutputTokens = u.output_tokens;
                } else if (event === 'message_delta' && data?.usage) {
                  const u = data.usage;
                  if (typeof u.output_tokens === 'number')
                    proxyOutputTokens = u.output_tokens;
                  if (typeof u.input_tokens === 'number' && proxyInputTokens == null)
                    proxyInputTokens = u.input_tokens;
                }
                sse.send(event, data);
              } catch (e) {
                // ignore parse errors for partial chunks
              }
            }
          }
        }
      }
      sse.end();
    } catch (err) {
      console.error(`[proxy:anthropic] internal error: ${err.message}`);
      sse.send('error', { message: err.message });
      sse.end();
    } finally {
      if (proxyInputTokens != null || proxyOutputTokens != null) {
        const estimate = textPriceFor(model, {
          inputTokens: proxyInputTokens ?? 0,
          outputTokens: proxyOutputTokens ?? 0,
          cachedReadTokens: proxyCachedRead ?? 0,
        });
        writeUsageLog(db, {
          ts: Date.now(),
          surface: 'text',
          provider: 'anthropic-proxy',
          model,
          inputTokens: proxyInputTokens,
          outputTokens: proxyOutputTokens,
          cachedReadTokens: proxyCachedRead,
          cachedWriteTokens: proxyCachedWrite,
          costUsdEstimate: estimate,
          costSource: estimate == null ? 'pricing-table-missing' : 'pricing-table',
        });
      }
    }
  });

  router.post('/proxy/openai/stream', async (req, res) => {
    /** @type {Partial<import('@open-design/contracts').ProxyStreamRequest>} */
    const proxyBody = req.body || {};
    const { baseUrl, apiKey, model, systemPrompt, messages, maxTokens } =
      proxyBody;
    if (!baseUrl || !apiKey || !model) {
      return sendApiError(
        res,
        400,
        'BAD_REQUEST',
        'baseUrl, apiKey, and model are required',
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

    const clean = baseUrl.replace(/\/+$/, '');
    const url = /\/v\d+$/.test(clean)
      ? `${clean}/chat/completions`
      : `${clean}/v1/chat/completions`;
    console.log(
      `[proxy:openai] ${req.method} ${validated.parsed.hostname} model=${model}`,
    );

    const payloadMessages = Array.isArray(messages) ? [...messages] : [];
    if (typeof systemPrompt === 'string' && systemPrompt) {
      payloadMessages.unshift({ role: 'system', content: systemPrompt });
    }

    const payload = {
      model,
      messages: payloadMessages,
      max_tokens:
        typeof maxTokens === 'number' && maxTokens > 0 ? maxTokens : 8192,
      stream: true,
      // Ask compatible providers for the final usage chunk so we can
      // record token counts. Providers that ignore stream_options just
      // omit the chunk; we degrade to no metering, never error.
      stream_options: { include_usage: true },
    };

    const sse = createSseResponse(res);
    let openaiInputTokens = null;
    let openaiOutputTokens = null;
    let openaiCachedRead = null;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `[proxy:openai] upstream error: ${response.status} ${redactAuthTokens(errorText)}`,
        );
        sse.send('error', {
          message: `Upstream error: ${response.status}`,
          details: errorText,
        });
        return sse.end();
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (dataStr === '[DONE]') break;
            try {
              const data = JSON.parse(dataStr);
              if (data?.usage) {
                if (typeof data.usage.prompt_tokens === 'number')
                  openaiInputTokens = data.usage.prompt_tokens;
                if (typeof data.usage.completion_tokens === 'number')
                  openaiOutputTokens = data.usage.completion_tokens;
                if (
                  data.usage.prompt_tokens_details?.cached_tokens != null
                ) {
                  openaiCachedRead =
                    data.usage.prompt_tokens_details.cached_tokens;
                }
              }
              sse.send('message', data);
            } catch (e) {
              // ignore parse errors for partial chunks
            }
          }
        }
      }
      sse.end();
    } catch (err) {
      console.error(`[proxy:openai] internal error: ${err.message}`);
      sse.send('error', { message: err.message });
      sse.end();
    } finally {
      if (openaiInputTokens != null || openaiOutputTokens != null) {
        const estimate = textPriceFor(model, {
          inputTokens: openaiInputTokens ?? 0,
          outputTokens: openaiOutputTokens ?? 0,
          cachedReadTokens: openaiCachedRead ?? 0,
        });
        writeUsageLog(db, {
          ts: Date.now(),
          surface: 'text',
          provider: 'openai-proxy',
          model,
          inputTokens: openaiInputTokens,
          outputTokens: openaiOutputTokens,
          cachedReadTokens: openaiCachedRead,
          costUsdEstimate: estimate,
          costSource: estimate == null ? 'pricing-table-missing' : 'pricing-table',
        });
      }
    }
  });

  return router;
}
