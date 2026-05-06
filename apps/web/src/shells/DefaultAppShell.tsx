import { EntryView } from '../components/EntryView';
import { PetOverlay } from '../components/pet/PetOverlay';
import { ProjectView } from '../components/ProjectView';
import { SettingsDialog } from '../components/SettingsDialog';
import type { DefaultAppShellProps } from './types';

export function DefaultAppShell({
  activeProject,
  routeFileName,
  config,
  agents,
  skills,
  designSystems,
  projects,
  templates,
  promptTemplates,
  daemonLive,
  bootstrapping,
  appVersionInfo,
  settingsOpen,
  settingsWelcome,
  settingsSection,
  onModeChange,
  onAgentChange,
  onAgentModelChange,
  onRefreshAgents,
  onOpenSettings,
  onOpenPetSettings,
  onAdoptPetInline,
  onTogglePet,
  onTuckPet,
  onBack,
  onClearPendingPrompt,
  onTouchProject,
  onProjectChange,
  onProjectsRefresh,
  onCreateProject,
  onImportClaudeDesign,
  onOpenProject,
  onDeleteProject,
  onChangeDefaultDesignSystem,
  onRefreshDesignSystems,
  onSaveSettings,
  onCloseSettings,
}: DefaultAppShellProps) {
  return (
    <>
      {activeProject ? (
        <ProjectView
          key={activeProject.id}
          project={activeProject}
          routeFileName={routeFileName}
          config={config}
          agents={agents}
          skills={skills}
          designSystems={designSystems}
          daemonLive={daemonLive}
          onModeChange={onModeChange}
          onAgentChange={onAgentChange}
          onAgentModelChange={onAgentModelChange}
          onRefreshAgents={onRefreshAgents}
          onOpenSettings={onOpenSettings}
          onAdoptPetInline={onAdoptPetInline}
          onTogglePet={onTogglePet}
          onOpenPetSettings={onOpenPetSettings}
          onBack={onBack}
          onClearPendingPrompt={onClearPendingPrompt}
          onTouchProject={onTouchProject}
          onProjectChange={onProjectChange}
          onProjectsRefresh={onProjectsRefresh}
        />
      ) : (
        <EntryView
          skills={skills}
          designSystems={designSystems}
          projects={projects}
          templates={templates}
          promptTemplates={promptTemplates}
          defaultDesignSystemId={config.designSystemId}
          config={config}
          agents={agents}
          loading={bootstrapping}
          onCreateProject={onCreateProject}
          onImportClaudeDesign={onImportClaudeDesign}
          onOpenProject={onOpenProject}
          onDeleteProject={onDeleteProject}
          onChangeDefaultDesignSystem={onChangeDefaultDesignSystem}
          onOpenSettings={onOpenSettings}
          onAdoptPet={onOpenPetSettings}
          onAdoptPetInline={onAdoptPetInline}
          onTogglePet={onTogglePet}
          onRefreshDesignSystems={onRefreshDesignSystems}
        />
      )}
      <PetOverlay
        pet={config.pet?.enabled ? config.pet : undefined}
        onTuck={onTuckPet}
        onOpenSettings={onOpenPetSettings}
      />
      {settingsOpen ? (
        <SettingsDialog
          initial={config}
          agents={agents}
          daemonLive={daemonLive}
          appVersionInfo={appVersionInfo}
          welcome={settingsWelcome}
          defaultSection={settingsSection}
          onSave={onSaveSettings}
          onClose={onCloseSettings}
          onRefreshAgents={onRefreshAgents}
        />
      ) : null}
    </>
  );
}
