import type express from 'express';
import { createProjectsRouter } from './projects.js';
import { createTemplatesRouter } from './templates.js';
import { createSkillsRouter } from './skills.js';
import { createDesignSystemsRouter } from './design-systems.js';
import { createCodexPetsRouter } from './codex-pets.js';
import { createArtifactsRouter } from './artifacts.js';
import { createMediaRouter } from './media.js';
import { createChatRouter } from './chat.js';
import { createUsageRouter } from './usage.js';
import { createCapabilitiesRouter } from './capabilities.js';
import { createScenariosRouter } from './scenarios.js';

export function registerApiRoutes(app: express.Express, ctx: unknown): void {
  app.use('/api', createProjectsRouter(ctx));
  app.use('/api', createTemplatesRouter(ctx));
  app.use('/api', createSkillsRouter(ctx));
  app.use('/api', createDesignSystemsRouter(ctx));
  app.use('/api', createCodexPetsRouter(ctx));
  app.use('/api', createArtifactsRouter(ctx));
  app.use('/api', createMediaRouter(ctx));
  app.use('/api', createChatRouter(ctx));
  app.use('/api', createUsageRouter(ctx));
  app.use('/api', createCapabilitiesRouter(ctx));
  app.use('/api', createScenariosRouter(ctx));
}
