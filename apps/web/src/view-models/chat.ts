import { composeSystemPrompt } from '@open-design/contracts';
import type {
  DesignSystemSummary,
  Project,
  ProjectTemplate,
  SkillSummary,
} from '../types';

export interface ProjectPromptContext {
  project: Project;
  skills: SkillSummary[];
  designSystems: DesignSystemSummary[];
  skillBody?: string;
  designSystemBody?: string;
  template?: ProjectTemplate;
}

export function toProjectSystemPrompt({
  project,
  skills,
  designSystems,
  skillBody,
  designSystemBody,
  template,
}: ProjectPromptContext): string {
  const skill = skills.find((s) => s.id === project.skillId) ?? null;
  const designSystem =
    designSystems.find((d) => d.id === project.designSystemId) ?? null;
  return composeSystemPrompt({
    skillBody,
    skillName: skill?.name,
    skillMode: skill?.mode,
    designSystemBody,
    designSystemTitle: designSystem?.title,
    metadata: project.metadata,
    template,
  });
}
