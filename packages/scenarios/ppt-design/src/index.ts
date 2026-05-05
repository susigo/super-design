import { SCENARIO_PROTOCOL_VERSION, type ScenarioManifest } from '@open-design/scenarios-core';

export const pptDesignManifest: ScenarioManifest = {
  id: 'ppt-design',
  version: '0.1.0',
  protocol: SCENARIO_PROTOCOL_VERSION,
  displayName: { en: 'PPT Design', 'zh-CN': 'PPT 设计' },
  capabilities: [
    { id: 'image-gen', version: '^0', required: true },
    { id: 'music-gen', version: '^0', required: false },
  ],
  designSystems: { requires: true, defaultId: 'default' },
  modes: ['chat'],
};
