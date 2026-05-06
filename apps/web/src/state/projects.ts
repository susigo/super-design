// Project / conversation / message / tab persistence — backed by the
// daemon's SQLite store. All writes round-trip through HTTP so projects
// stay coherent across multiple browser tabs and across restarts.
//
// These helpers fail soft (returning null / [] on transport errors) so
// the UI can stay rendered when the daemon is briefly unreachable.

import { daemonJson, daemonOk } from '../client/daemon-client';
import type {
  ChatMessage,
  Conversation,
  OpenTabsState,
  Project,
  ProjectMetadata,
  ProjectTemplate,
} from '../types';

export async function listProjects(): Promise<Project[]> {
  try {
    const json = await daemonJson<{ projects: Project[] }>('/api/projects');
    return json.projects ?? [];
  } catch {
    return [];
  }
}

export async function getProject(id: string): Promise<Project | null> {
  try {
    const json = await daemonJson<{ project: Project }>(
      `/api/projects/${encodeURIComponent(id)}`,
    );
    return json.project;
  } catch {
    return null;
  }
}

export async function createProject(input: {
  name: string;
  skillId: string | null;
  designSystemId: string | null;
  pendingPrompt?: string;
  metadata?: ProjectMetadata;
}): Promise<{ project: Project; conversationId: string } | null> {
  try {
    const id = crypto.randomUUID();
    return await daemonJson<{ project: Project; conversationId: string }>(
      '/api/projects',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...input }),
      },
    );
  } catch {
    return null;
  }
}

export async function importClaudeDesignZip(
  file: File,
): Promise<{ project: Project; conversationId: string; entryFile: string } | null> {
  try {
    const form = new FormData();
    form.append('file', file);
    return await daemonJson<{
      project: Project;
      conversationId: string;
      entryFile: string;
    }>('/api/import/claude-design', {
      method: 'POST',
      body: form,
    });
  } catch {
    return null;
  }
}

// ---------- templates ----------

export async function listTemplates(): Promise<ProjectTemplate[]> {
  try {
    const json = await daemonJson<{ templates: ProjectTemplate[] }>('/api/templates');
    return json.templates ?? [];
  } catch {
    return [];
  }
}

export async function getTemplate(id: string): Promise<ProjectTemplate | null> {
  try {
    const json = await daemonJson<{ template: ProjectTemplate }>(
      `/api/templates/${encodeURIComponent(id)}`,
    );
    return json.template;
  } catch {
    return null;
  }
}

export async function saveTemplate(input: {
  name: string;
  description?: string;
  sourceProjectId: string;
}): Promise<ProjectTemplate | null> {
  try {
    const json = await daemonJson<{ template: ProjectTemplate }>('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return json.template;
  } catch {
    return null;
  }
}

export async function deleteTemplate(id: string): Promise<boolean> {
  try {
    return await daemonOk(`/api/templates/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  } catch {
    return false;
  }
}

export async function patchProject(
  id: string,
  patch: Partial<Project>,
): Promise<Project | null> {
  try {
    const json = await daemonJson<{ project: Project }>(
      `/api/projects/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      },
    );
    return json.project;
  } catch {
    return null;
  }
}

export async function deleteProject(id: string): Promise<boolean> {
  try {
    return await daemonOk(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  } catch {
    return false;
  }
}

// ---------- conversations ----------

export async function listConversations(
  projectId: string,
): Promise<Conversation[]> {
  try {
    const json = await daemonJson<{ conversations: Conversation[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/conversations`,
    );
    return json.conversations ?? [];
  } catch {
    return [];
  }
}

export async function createConversation(
  projectId: string,
  title?: string,
): Promise<Conversation | null> {
  try {
    const json = await daemonJson<{ conversation: Conversation }>(
      `/api/projects/${encodeURIComponent(projectId)}/conversations`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      },
    );
    return json.conversation;
  } catch {
    return null;
  }
}

export async function patchConversation(
  projectId: string,
  conversationId: string,
  patch: Partial<Conversation>,
): Promise<Conversation | null> {
  try {
    const json = await daemonJson<{ conversation: Conversation }>(
      `/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      },
    );
    return json.conversation;
  } catch {
    return null;
  }
}

export async function deleteConversation(
  projectId: string,
  conversationId: string,
): Promise<boolean> {
  try {
    return await daemonOk(
      `/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}`,
      { method: 'DELETE' },
    );
  } catch {
    return false;
  }
}

// ---------- messages ----------

export async function listMessages(
  projectId: string,
  conversationId: string,
): Promise<ChatMessage[]> {
  try {
    const json = await daemonJson<{ messages: ChatMessage[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
    );
    return json.messages ?? [];
  } catch {
    return [];
  }
}

export async function saveMessage(
  projectId: string,
  conversationId: string,
  message: ChatMessage,
): Promise<void> {
  try {
    await daemonOk(
      `/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(message.id)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      },
    );
  } catch {
    // best-effort persistence — UI keeps the message in-memory either way
  }
}

// ---------- tabs ----------

export async function loadTabs(projectId: string): Promise<OpenTabsState> {
  try {
    return await daemonJson<OpenTabsState>(
      `/api/projects/${encodeURIComponent(projectId)}/tabs`,
    );
  } catch {
    return { tabs: [], active: null };
  }
}

export async function saveTabs(
  projectId: string,
  state: OpenTabsState,
): Promise<void> {
  try {
    await daemonOk(`/api/projects/${encodeURIComponent(projectId)}/tabs`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
  } catch {
    // best-effort
  }
}
