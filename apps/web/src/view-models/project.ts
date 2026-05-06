import type { Project, ProjectKind, ProjectTemplate } from '../types';

export interface ProjectCardViewModel {
  id: string;
  name: string;
  status: Project['status'];
  kind: ProjectKind | null;
  updatedAt: number;
  createdAt: number;
  hasPendingPrompt: boolean;
  skillId: string | null;
  designSystemId: string | null;
}

export interface ProjectListViewModel {
  projects: ProjectCardViewModel[];
  isEmpty: boolean;
}

export interface ProjectTemplateViewModel {
  id: string;
  name: string;
  description: string;
}

export function toProjectCardViewModel(project: Project): ProjectCardViewModel {
  return {
    id: project.id,
    name: project.name,
    status: project.status,
    kind: project.metadata?.kind ?? null,
    updatedAt: project.updatedAt,
    createdAt: project.createdAt,
    hasPendingPrompt: Boolean(project.pendingPrompt?.trim()),
    skillId: project.skillId ?? null,
    designSystemId: project.designSystemId ?? null,
  };
}

export function toProjectListViewModel(
  projects: Project[],
): ProjectListViewModel {
  return {
    projects: projects.map(toProjectCardViewModel),
    isEmpty: projects.length === 0,
  };
}

export function toProjectTemplateViewModel(
  template: ProjectTemplate,
): ProjectTemplateViewModel {
  return {
    id: template.id,
    name: template.name,
    description: template.description ?? '',
  };
}
