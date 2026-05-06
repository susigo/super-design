import express from 'express';

interface ScenarioManifestResponse {
  id: string;
  version: string;
  displayName: Record<string, string>;
  capabilities: { id: string; version: string; required: boolean }[];
  modes: string[];
}

const KNOWN_SCENARIOS: ScenarioManifestResponse[] = [
  {
    id: 'ppt-design',
    version: '0.1.0',
    displayName: { en: 'PPT Design', 'zh-CN': 'PPT 设计' },
    capabilities: [
      { id: 'image-gen', version: '^0', required: true },
      { id: 'music-gen', version: '^0', required: false },
    ],
    modes: ['chat'],
  },
  {
    id: 'frontend-design',
    version: '0.1.0',
    displayName: { en: 'Frontend Design', 'zh-CN': '前端设计' },
    capabilities: [
      { id: 'image-gen', version: '^0', required: false },
    ],
    modes: ['chat', 'sketch'],
  },
];

export function createScenariosRouter(_ctx: unknown): import('express').Router {
  const router = express.Router();

  router.get('/v2/scenarios', (_req, res) => {
    res.json({ scenarios: KNOWN_SCENARIOS });
  });

  return router;
}
