import { createScenarioRunner } from './orchestrator/runner.js';
import { pptDesignScenario } from './scenarios/ppt-design/index.js';
import { frontendDesignScenario } from './scenarios/frontend-design/index.js';
import { createChatRunService } from './runs.js';
import { openDatabase } from './db.js';
import { createSseResponse, createSseErrorPayload } from './routes/helpers.js';
import {
  ARTIFACTS_DIR,
  BUNDLED_PETS_DIR,
  CRAFT_DIR,
  DESIGN_SYSTEM_ROOTS,
  FRAMES_DIR,
  OD_BIN,
  PROJECT_ROOT,
  PROJECTS_DIR,
  PROMPT_TEMPLATES_DIR,
  RUNTIME_DATA_DIR,
  SKILLS_DIR,
  STAGING_DIR,
  USER_DESIGN_SYSTEMS_DIR,
  ensureDaemonRuntimeDirs,
} from './resources.js';

export function createDaemonAppContext({ port }: { readonly port: number }): any {
  ensureDaemonRuntimeDirs();

  const db = openDatabase(PROJECT_ROOT, { dataDir: RUNTIME_DATA_DIR });
  const design = {
    runs: createChatRunService({ createSseResponse, createSseErrorPayload }),
  };
  const scenarioRunner = createScenarioRunner(db);

  return {
    db,
    port,
    projectRoot: PROJECT_ROOT,
    projectsDir: PROJECTS_DIR,
    skillsDir: SKILLS_DIR,
    designSystemRoots: DESIGN_SYSTEM_ROOTS,
    userDesignSystemsDir: USER_DESIGN_SYSTEMS_DIR,
    stagingDir: STAGING_DIR,
    artifactsDir: ARTIFACTS_DIR,
    framesDir: FRAMES_DIR,
    bundledPetsDir: BUNDLED_PETS_DIR,
    promptTemplatesDir: PROMPT_TEMPLATES_DIR,
    craftDir: CRAFT_DIR,
    odBin: OD_BIN,
    runtimeDataDir: RUNTIME_DATA_DIR,
    design,
    scenarioRunner,
    pptDesignScenario,
    frontendDesignScenario,
  };
}
