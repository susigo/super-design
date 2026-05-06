import type { CreateInput } from '../components/NewProjectPanel';
import type { SettingsSection } from '../components/SettingsDialog';
import type {
  AgentInfo,
  AppConfig,
  AppVersionInfo,
  DesignSystemSummary,
  Project,
  ProjectTemplate,
  PromptTemplateSummary,
  SkillSummary,
} from '../types';

export interface DefaultAppShellProps {
  activeProject: Project | null;
  routeFileName: string | null;
  config: AppConfig;
  agents: AgentInfo[];
  skills: SkillSummary[];
  designSystems: DesignSystemSummary[];
  projects: Project[];
  templates: ProjectTemplate[];
  promptTemplates: PromptTemplateSummary[];
  daemonLive: boolean;
  bootstrapping: boolean;
  appVersionInfo: AppVersionInfo | null;
  settingsOpen: boolean;
  settingsWelcome: boolean;
  settingsSection?: SettingsSection;
  onModeChange: (mode: AppConfig['mode']) => void;
  onAgentChange: (id: string) => void;
  onAgentModelChange: (
    id: string,
    choice: { model?: string; reasoning?: string },
  ) => void;
  onRefreshAgents: () => void;
  onOpenSettings: () => void;
  onOpenPetSettings: () => void;
  onAdoptPetInline: (petId: string) => void;
  onTogglePet: () => void;
  onTuckPet: () => void;
  onBack: () => void;
  onClearPendingPrompt: () => void;
  onTouchProject: () => void;
  onProjectChange: (next: Project) => void;
  onProjectsRefresh: () => void;
  onCreateProject: (input: CreateInput & { pendingPrompt?: string }) => void;
  onImportClaudeDesign: (file: File) => Promise<void> | void;
  onOpenProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onChangeDefaultDesignSystem: (id: string) => void;
  onRefreshDesignSystems: () => Promise<void>;
  onSaveSettings: (next: AppConfig) => void;
  onCloseSettings: () => void;
}
