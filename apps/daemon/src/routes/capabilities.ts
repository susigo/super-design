import express from 'express';
import type { CapabilityDescriptor } from '@open-design/capabilities-core';
import { imageGenCapabilityDescriptor } from '@open-design/capabilities-image-gen';
import { musicGenCapabilityDescriptor } from '@open-design/capabilities-music-gen';

type CapabilityDescriptorResponse = Omit<CapabilityDescriptor, 'protocol'>;

const KNOWN_CAPABILITIES: CapabilityDescriptorResponse[] = [
  toCapabilityDescriptorResponse(imageGenCapabilityDescriptor),
  toCapabilityDescriptorResponse(musicGenCapabilityDescriptor),
];

function toCapabilityDescriptorResponse(
  descriptor: CapabilityDescriptor,
): CapabilityDescriptorResponse {
  const { protocol: _protocol, ...rest } = descriptor;
  return rest;
}

export function createCapabilitiesRouter(_ctx: unknown): import('express').Router {
  const router = express.Router();

  router.get('/v2/capabilities', (_req, res) => {
    res.json({ capabilities: KNOWN_CAPABILITIES });
  });

  return router;
}
