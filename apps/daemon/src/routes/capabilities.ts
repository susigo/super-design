import express from 'express';

interface CapabilityDescriptorResponse {
  id: string;
  version: string;
  providers: string[];
  cost: { unit: string; defaultUsdPerUnit?: number };
}

const KNOWN_CAPABILITIES: CapabilityDescriptorResponse[] = [
  {
    id: 'image-gen',
    version: '0.1.0',
    providers: ['openai', 'volcengine', 'grok'],
    cost: { unit: 'image', defaultUsdPerUnit: 0.04 },
  },
  {
    id: 'music-gen',
    version: '0.1.0',
    providers: ['suno', 'udio', 'google'],
    cost: { unit: 'second', defaultUsdPerUnit: 0.01 },
  },
];

export function createCapabilitiesRouter(_ctx: unknown): import('express').Router {
  const router = express.Router();

  router.get('/v2/capabilities', (_req, res) => {
    res.json({ capabilities: KNOWN_CAPABILITIES });
  });

  return router;
}
