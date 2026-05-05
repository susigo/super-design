import { SCENARIO_PROTOCOL_VERSION, type ScenarioManifest } from '@open-design/scenarios-core';

export const frontendDesignManifest: ScenarioManifest = {
  id: 'frontend-design',
  version: '0.1.0',
  protocol: SCENARIO_PROTOCOL_VERSION,
  displayName: { en: 'Frontend Design', 'zh-CN': '前端设计' },
  capabilities: [{ id: 'image-gen', version: '^0', required: false }],
  designSystems: { requires: true, defaultId: 'default' },
  modes: ['chat', 'sketch'],
};
