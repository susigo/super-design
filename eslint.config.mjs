import tsParser from '@typescript-eslint/parser';

const sourceFiles = ['**/*.{js,mjs,cjs,ts,tsx}'];
const appPackages = [
  '@open-design/web',
  '@open-design/web/*',
  '@open-design/daemon',
  '@open-design/daemon/*',
  '@open-design/desktop',
  '@open-design/desktop/*',
  '@open-design/packaged',
  '@open-design/packaged/*',
];
const appPathPatterns = [
  'apps/*',
  'apps/**',
  '../apps/*',
  '../apps/**',
  '../../apps/*',
  '../../apps/**',
  '../../../apps/*',
  '../../../apps/**',
  '../../../../apps/*',
  '../../../../apps/**',
  '../../../../../apps/*',
  '../../../../../apps/**',
];
const sidecarPackages = [
  '@open-design/platform',
  '@open-design/platform/*',
  '@open-design/sidecar',
  '@open-design/sidecar/*',
  '@open-design/sidecar-proto',
  '@open-design/sidecar-proto/*',
];
const runtimePackages = [
  'better-sqlite3',
  'electron',
  'express',
  'express/*',
  'next',
  'next/*',
  'multer',
  'node:*',
];

function restrictedImports(patterns, message) {
  return ['error', { patterns: [{ group: patterns, message }] }];
}

export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '.claude/**',
      '.od/**',
      '.tmp/**',
      'apps/web/.next/**',
      'e2e/playwright-report/**',
      'e2e/reports/**',
      'test-results/**',
    ],
  },
  {
    files: sourceFiles,
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    ignores: ['apps/web/sidecar/**'],
    rules: {
      'no-restricted-imports': restrictedImports(
        [
          '@open-design/daemon',
          '@open-design/daemon/*',
          '@open-design/desktop',
          '@open-design/desktop/*',
          '@open-design/packaged',
          '@open-design/packaged/*',
          ...sidecarPackages,
        ],
        'Web runtime code must stay behind the daemon contract and must not import app, platform, or sidecar internals.',
      ),
    },
  },
  {
    files: ['apps/daemon/**/*.{js,ts}'],
    ignores: ['apps/daemon/sidecar/**'],
    rules: {
      'no-restricted-imports': restrictedImports(
        [
          '@open-design/web',
          '@open-design/web/*',
          '@open-design/desktop',
          '@open-design/desktop/*',
          '@open-design/packaged',
          '@open-design/packaged/*',
        ],
        'Daemon runtime code must not import web, desktop, or packaged app internals.',
      ),
    },
  },
  {
    files: ['apps/desktop/src/main/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restrictedImports(
        [
          '@open-design/web',
          '@open-design/web/*',
          '@open-design/daemon',
          '@open-design/daemon/*',
          '@open-design/packaged',
          '@open-design/packaged/*',
        ],
        'Desktop main code must not import web, daemon, or packaged app internals.',
      ),
    },
  },
  {
    files: ['apps/packaged/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restrictedImports(
        [
          'apps/web/src/*',
          'apps/web/src/**',
          'apps/daemon/src/*',
          'apps/daemon/src/**',
          '../web/src/*',
          '../web/src/**',
          '../daemon/src/*',
          '../daemon/src/**',
          '../../web/src/*',
          '../../web/src/**',
          '../../daemon/src/*',
          '../../daemon/src/**',
          '../../../apps/web/src/*',
          '../../../apps/web/src/**',
          '../../../apps/daemon/src/*',
          '../../../apps/daemon/src/**',
        ],
        'Packaged runtime must use app package entrypoints rather than reaching into web or daemon source internals.',
      ),
    },
  },
  {
    files: [
      'packages/contracts/src/**/*.{ts,tsx}',
      'packages/platform/src/**/*.{ts,tsx}',
      'packages/sidecar/src/**/*.{ts,tsx}',
      'packages/sidecar-proto/src/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': restrictedImports(
        appPackages,
        'Shared packages must not import app packages.',
      ),
    },
  },
  {
    files: ['packages/capabilities/core/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restrictedImports(
        [
          ...appPackages,
          ...appPathPatterns,
          ...sidecarPackages,
          ...runtimePackages,
          '@open-design/capabilities-image-gen',
          '@open-design/capabilities-image-gen/*',
          '@open-design/capabilities-music-gen',
          '@open-design/capabilities-music-gen/*',
          '@open-design/scenarios-core',
          '@open-design/scenarios-core/*',
          '@open-design/scenarios-frontend-design',
          '@open-design/scenarios-frontend-design/*',
          '@open-design/scenarios-ppt-design',
          '@open-design/scenarios-ppt-design/*',
        ],
        'Capability core contracts must stay pure and independent of apps, runtimes, feature capabilities, and scenarios.',
      ),
    },
  },
  {
    files: ['packages/capabilities/image-gen/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restrictedImports(
        [
          ...appPackages,
          ...appPathPatterns,
          ...sidecarPackages,
          ...runtimePackages,
          '@open-design/capabilities-music-gen',
          '@open-design/capabilities-music-gen/*',
          '@open-design/scenarios-core',
          '@open-design/scenarios-core/*',
          '@open-design/scenarios-frontend-design',
          '@open-design/scenarios-frontend-design/*',
          '@open-design/scenarios-ppt-design',
          '@open-design/scenarios-ppt-design/*',
        ],
        'Capability contract packages must stay pure and must not import apps, runtimes, scenarios, or sibling capabilities.',
      ),
    },
  },
  {
    files: ['packages/capabilities/music-gen/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restrictedImports(
        [
          ...appPackages,
          ...appPathPatterns,
          ...sidecarPackages,
          ...runtimePackages,
          '@open-design/capabilities-image-gen',
          '@open-design/capabilities-image-gen/*',
          '@open-design/scenarios-core',
          '@open-design/scenarios-core/*',
          '@open-design/scenarios-frontend-design',
          '@open-design/scenarios-frontend-design/*',
          '@open-design/scenarios-ppt-design',
          '@open-design/scenarios-ppt-design/*',
        ],
        'Capability contract packages must stay pure and must not import apps, runtimes, scenarios, or sibling capabilities.',
      ),
    },
  },
  {
    files: ['packages/scenarios/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restrictedImports(
        [
          ...appPackages,
          ...appPathPatterns,
          ...sidecarPackages,
          ...runtimePackages,
        ],
        'Scenario contract packages must stay pure and must not import apps, runtimes, or sidecar internals.',
      ),
    },
  },
];
