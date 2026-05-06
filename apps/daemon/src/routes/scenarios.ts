import express from 'express';
import type { ScenarioManifest } from '@open-design/scenarios-core';
import { frontendDesignManifest } from '@open-design/scenarios-frontend-design';
import { pptDesignManifest } from '@open-design/scenarios-ppt-design';

type ScenarioManifestResponse = Pick<
  ScenarioManifest,
  'id' | 'version' | 'displayName' | 'capabilities' | 'modes'
>;

const KNOWN_SCENARIOS: ScenarioManifestResponse[] = [
  toScenarioManifestResponse(pptDesignManifest),
  toScenarioManifestResponse(frontendDesignManifest),
];

function toScenarioManifestResponse(
  manifest: ScenarioManifest,
): ScenarioManifestResponse {
  const { protocol: _protocol, designSystems: _designSystems, ...rest } = manifest;
  return rest;
}

export function createScenariosRouter(_ctx: unknown): import('express').Router {
  const router = express.Router();

  router.get('/v2/scenarios', (_req, res) => {
    res.json({ scenarios: KNOWN_SCENARIOS });
  });

  return router;
}
