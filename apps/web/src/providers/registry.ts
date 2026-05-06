import { daemonJson, daemonOk, daemonText, DaemonRequestError } from '../client/daemon-client';
import type {
  AgentInfo,
  AppVersionInfo,
  AppVersionResponse,
  CapabilityDescriptorResponse,
  CapabilitiesResponse,
  ChatAttachment,
  CodexPetSummary,
  CodexPetsResponse,
  SyncCommunityPetsRequest,
  SyncCommunityPetsResponse,
  PreviewComment,
  PreviewCommentStatus,
  PreviewCommentUpsertRequest,
  DeployConfigResponse,
  DeployProjectFileResponse,
  DesignSystemDetail,
  DesignSystemSummary,
  ProjectDeploymentsResponse,
  PromptTemplateDetail,
  PromptTemplateSummary,
  ProjectFile,
  ScenarioManifestResponse,
  ScenariosResponse,
  SkillDetail,
  SkillSummary,
  UpdateDeployConfigRequest,
} from '../types';
import type { ArtifactManifest } from '../artifacts/types';

export async function fetchAgents(): Promise<AgentInfo[]> {
  try {
    const json = await daemonJson<{ agents: AgentInfo[] }>('/api/agents');
    return json.agents ?? [];
  } catch {
    return [];
  }
}

export async function fetchSkills(): Promise<SkillSummary[]> {
  try {
    const json = await daemonJson<{ skills: SkillSummary[] }>('/api/skills');
    return json.skills ?? [];
  } catch {
    return [];
  }
}

// Pets packaged by the Codex `hatch-pet` skill — surfaced so the web
// pet settings can offer one-click adoption right after the agent run
// finishes. Returns an empty list (not an error) when the registry
// folder is missing so the "Recently hatched" UI can simply render an
// empty state.
export async function fetchCodexPets(): Promise<CodexPetsResponse> {
  try {
    return await daemonJson<CodexPetsResponse>('/api/codex-pets');
  } catch {
    return { pets: [], rootDir: '' };
  }
}

// One-click trigger for the daemon-side port of `sync-community-pets`.
// Always resolves with a summary (even when the daemon errored) so the
// caller can render a status line without having to wrap in try/catch
// on every keystroke.
export async function syncCommunityPets(
  input?: SyncCommunityPetsRequest,
): Promise<SyncCommunityPetsResponse & { error?: string }> {
  try {
    return await daemonJson<SyncCommunityPetsResponse & { error?: string }>(
      '/api/codex-pets/sync',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input ?? {}),
      },
    );
  } catch (err) {
    return {
      wrote: 0,
      skipped: 0,
      failed: 0,
      total: 0,
      rootDir: '',
      errors: [],
      error: err instanceof Error ? err.message : 'Sync request failed',
    };
  }
}

export function codexPetSpritesheetUrl(pet: CodexPetSummary): string {
  // The daemon stamps an absolute path-prefix in `spritesheetUrl`; if
  // that prefix is empty (default), it is already a same-origin path
  // we can hand to <img src> or fetch() as-is.
  return pet.spritesheetUrl;
}

export async function fetchSkill(id: string): Promise<SkillDetail | null> {
  try {
    return await daemonJson<SkillDetail>(`/api/skills/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
}

export async function fetchDesignSystems(): Promise<DesignSystemSummary[]> {
  try {
    const json = await daemonJson<{ designSystems: DesignSystemSummary[] }>('/api/design-systems');
    return json.designSystems ?? [];
  } catch {
    return [];
  }
}

export async function fetchDesignSystem(id: string): Promise<DesignSystemDetail | null> {
  try {
    return await daemonJson<DesignSystemDetail>(
      `/api/design-systems/${encodeURIComponent(id)}`,
    );
  } catch {
    return null;
  }
}

export async function fetchPromptTemplates(): Promise<PromptTemplateSummary[]> {
  try {
    const json = await daemonJson<{ promptTemplates: PromptTemplateSummary[] }>('/api/prompt-templates');
    return json.promptTemplates ?? [];
  } catch {
    return [];
  }
}

export async function fetchPromptTemplate(
  surface: 'image' | 'video',
  id: string,
): Promise<PromptTemplateDetail | null> {
  try {
    const json = await daemonJson<{ promptTemplate: PromptTemplateDetail }>(
      `/api/prompt-templates/${encodeURIComponent(surface)}/${encodeURIComponent(id)}`,
    );
    return json.promptTemplate ?? null;
  } catch {
    return null;
  }
}

export async function daemonIsLive(): Promise<boolean> {
  try {
    return await daemonOk('/api/health');
  } catch {
    return false;
  }
}

function isAppVersionInfo(value: unknown): value is AppVersionInfo {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AppVersionInfo>;
  return (
    typeof candidate.version === 'string' &&
    typeof candidate.channel === 'string' &&
    typeof candidate.packaged === 'boolean' &&
    typeof candidate.platform === 'string' &&
    typeof candidate.arch === 'string'
  );
}

export async function fetchAppVersionInfo(): Promise<AppVersionInfo | null> {
  try {
    const json = await daemonJson<Partial<AppVersionResponse>>('/api/version');
    return isAppVersionInfo(json.version) ? json.version : null;
  } catch {
    return null;
  }
}

export async function fetchSkillExample(id: string): Promise<string | null> {
  try {
    return await daemonText(`/api/skills/${encodeURIComponent(id)}/example`);
  } catch {
    return null;
  }
}

export async function fetchDeployConfig(): Promise<DeployConfigResponse | null> {
  try {
    return await daemonJson<DeployConfigResponse>('/api/deploy/config');
  } catch {
    return null;
  }
}

export async function updateDeployConfig(
  input: UpdateDeployConfigRequest,
): Promise<DeployConfigResponse | null> {
  try {
    return await daemonJson<DeployConfigResponse>('/api/deploy/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    return null;
  }
}

export async function fetchProjectDeployments(
  projectId: string,
): Promise<ProjectDeploymentsResponse['deployments']> {
  try {
    const json = await daemonJson<ProjectDeploymentsResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/deployments`,
    );
    return json.deployments ?? [];
  } catch {
    return [];
  }
}

export async function deployProjectFile(
  projectId: string,
  fileName: string,
): Promise<DeployProjectFileResponse> {
  return await daemonJson<DeployProjectFileResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/deploy`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName, providerId: 'vercel-self' }),
    },
  );
}

export async function checkDeploymentLink(
  projectId: string,
  deploymentId: string,
): Promise<DeployProjectFileResponse> {
  return await daemonJson<DeployProjectFileResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/deployments/${encodeURIComponent(deploymentId)}/check-link`,
    { method: 'POST' },
  );
}

// Project files — all paths are scoped under .od/projects/<id>/ on disk.

export async function fetchProjectFiles(projectId: string): Promise<ProjectFile[]> {
  try {
    const json = await daemonJson<{ files: ProjectFile[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/files`,
    );
    return json.files ?? [];
  } catch {
    return [];
  }
}

export function projectFileUrl(projectId: string, name: string): string {
  return projectRawUrl(projectId, name);
}

export interface ProjectFilePreviewSection {
  title: string;
  lines: string[];
}

export interface ProjectFilePreview {
  kind: 'pdf' | 'document' | 'presentation' | 'spreadsheet';
  title: string;
  sections: ProjectFilePreviewSection[];
}

export async function fetchProjectFilePreview(
  projectId: string,
  name: string,
): Promise<ProjectFilePreview | null> {
  try {
    return await daemonJson<ProjectFilePreview>(
      `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(name)}/preview`,
    );
  } catch {
    return null;
  }
}

export async function fetchProjectFileText(
  projectId: string,
  name: string,
  options?: { cache?: RequestCache; cacheBustKey?: string | number },
): Promise<string | null> {
  const url = projectFileUrl(projectId, name);
  const cacheBustKey = options?.cacheBustKey;
  const requestUrl =
    cacheBustKey == null
      ? url
      : `${url}${url.includes('?') ? '&' : '?'}cacheBust=${encodeURIComponent(String(cacheBustKey))}`;
  const init: RequestInit = {};
  if (options?.cache) init.cache = options.cache;

  try {
    return await daemonText(requestUrl, init);
  } catch (err) {
    const status = err instanceof DaemonRequestError ? err.error.status : undefined;
    console.warn('[fetchProjectFileText] failed:', {
      ...(status === undefined ? { error: err } : {}),
      name,
      projectId,
      ...(status === undefined ? {} : { status, statusText: statusTextFor(status) }),
      url: requestUrl,
    });
    return null;
  }
}

function statusTextFor(status: number): string {
  return status === 404 ? 'Not Found' : '';
}

export async function fetchPreviewComments(
  projectId: string,
  conversationId: string,
): Promise<PreviewComment[]> {
  try {
    const json = await daemonJson<{ comments: PreviewComment[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/comments`,
    );
    return json.comments ?? [];
  } catch {
    return [];
  }
}

export async function upsertPreviewComment(
  projectId: string,
  conversationId: string,
  input: PreviewCommentUpsertRequest,
): Promise<PreviewComment | null> {
  try {
    const json = await daemonJson<{ comment: PreviewComment }>(
      `/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/comments`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
    return json.comment ?? null;
  } catch {
    return null;
  }
}

export async function patchPreviewCommentStatus(
  projectId: string,
  conversationId: string,
  commentId: string,
  status: PreviewCommentStatus,
): Promise<PreviewComment | null> {
  try {
    const json = await daemonJson<{ comment: PreviewComment }>(
      `/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/comments/${encodeURIComponent(commentId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      },
    );
    return json.comment ?? null;
  } catch {
    return null;
  }
}

export async function deletePreviewComment(
  projectId: string,
  conversationId: string,
  commentId: string,
): Promise<boolean> {
  try {
    return await daemonOk(
      `/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/comments/${encodeURIComponent(commentId)}`,
      { method: 'DELETE' },
    );
  } catch {
    return false;
  }
}

export async function writeProjectTextFile(
  projectId: string,
  name: string,
  content: string,
  options?: { artifactManifest?: ArtifactManifest },
): Promise<ProjectFile | null> {
  try {
    const json = await daemonJson<{ file: ProjectFile }>(
      `/api/projects/${encodeURIComponent(projectId)}/files`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content, artifactManifest: options?.artifactManifest }),
      },
    );
    return json.file;
  } catch {
    return null;
  }
}

export async function writeProjectBase64File(
  projectId: string,
  name: string,
  base64: string,
): Promise<ProjectFile | null> {
  try {
    const json = await daemonJson<{ file: ProjectFile }>(
      `/api/projects/${encodeURIComponent(projectId)}/files`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content: base64, encoding: 'base64' }),
      },
    );
    return json.file;
  } catch {
    return null;
  }
}

export async function uploadProjectFile(
  projectId: string,
  file: File,
  desiredName?: string,
): Promise<ProjectFile | null> {
  try {
    const form = new FormData();
    form.append('file', file);
    if (desiredName) form.append('name', desiredName);
    const json = await daemonJson<{ file: ProjectFile }>(
      `/api/projects/${encodeURIComponent(projectId)}/files`,
      {
        method: 'POST',
        body: form,
      },
    );
    return json.file;
  } catch {
    return null;
  }
}

// Multi-file project upload used by the chat composer's paste / drop /
// picker. Each file lands flat in the project folder; the response is
// reshaped into ChatAttachments so the composer can stage them without a
// follow-up listFiles round-trip.
const PROJECT_UPLOAD_BATCH_SIZE = 12;

export interface ProjectUploadFailure {
  name: string;
  code?: string;
  error?: string;
}

export interface UploadProjectFilesResult {
  uploaded: ChatAttachment[];
  failed: ProjectUploadFailure[];
  error?: string;
}

export async function uploadProjectFiles(
  projectId: string,
  files: File[],
): Promise<UploadProjectFilesResult> {
  if (files.length === 0) return { uploaded: [], failed: [] };

  const uploaded: ChatAttachment[] = [];
  const failed: ProjectUploadFailure[] = [];
  let error: string | undefined;

  for (let i = 0; i < files.length; i += PROJECT_UPLOAD_BATCH_SIZE) {
    const batch = files.slice(i, i + PROJECT_UPLOAD_BATCH_SIZE);
    const remaining = files.slice(i + PROJECT_UPLOAD_BATCH_SIZE);
    const form = new FormData();
    for (const f of batch) form.append('files', f);

    try {
      const json = await daemonJson<{
        files: { name: string; path: string; size?: number; originalName?: string }[];
      }>(`/api/projects/${encodeURIComponent(projectId)}/upload`, {
        method: 'POST',
        body: form,
      });
      const responseFiles = json.files ?? [];
      uploaded.push(
        ...responseFiles.map((f) => ({
          path: f.path,
          name: f.originalName ?? f.name,
          kind: looksLikeImage(f.name) ? ('image' as const) : ('file' as const),
          size: f.size,
        })),
      );
      // Server preserves request order; any dropped files are unmatched at the batch tail.
      if (responseFiles.length < batch.length) {
        error ??= 'some files could not be stored';
        for (const f of batch.slice(responseFiles.length)) {
          failed.push({
            name: f.name,
            error: error ?? 'some files could not be stored',
          });
        }
      }
    } catch {
      error = 'upload request failed';
      for (const f of batch) {
        failed.push({ name: f.name, error });
      }
      for (const f of remaining) {
        failed.push({ name: f.name, error });
      }
      break;
    }
  }

  return { uploaded, failed, error };
}

// Stable URL that serves a project file with its original mime — for
// thumbnails in the staged-attachment chips and for any preview iframe
// that needs to point at the live file (not a srcDoc).
export function projectRawUrl(projectId: string, filePath: string): string {
  // Encode each path segment individually so a slash inside the file
  // path stays a path separator, not %2F.
  const safePath = filePath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return `/api/projects/${encodeURIComponent(projectId)}/raw/${safePath}`;
}

function looksLikeImage(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(name);
}

export async function deleteProjectFile(
  projectId: string,
  name: string,
): Promise<boolean> {
  try {
    return await daemonOk(projectRawUrl(projectId, name), { method: 'DELETE' });
  } catch {
    return false;
  }
}

export async function fetchDesignSystemPreview(id: string): Promise<string | null> {
  try {
    return await daemonText(`/api/design-systems/${encodeURIComponent(id)}/preview`);
  } catch {
    return null;
  }
}

export async function fetchCapabilities(): Promise<CapabilityDescriptorResponse[]> {
  try {
    const json = await daemonJson<CapabilitiesResponse>('/api/v2/capabilities');
    return json.capabilities ?? [];
  } catch {
    return [];
  }
}

export async function fetchScenarios(): Promise<ScenarioManifestResponse[]> {
  try {
    const json = await daemonJson<ScenariosResponse>('/api/v2/scenarios');
    return json.scenarios ?? [];
  } catch {
    return [];
  }
}

export async function fetchDesignSystemShowcase(id: string): Promise<string | null> {
  try {
    return await daemonText(`/api/design-systems/${encodeURIComponent(id)}/showcase`);
  } catch {
    return null;
  }
}
