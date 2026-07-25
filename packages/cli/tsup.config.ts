import { readFileSync } from 'node:fs';

import { defineConfig } from 'tsup';

interface CliPackageManifest {
  dependencies?: Record<string, string>;
}

const cliPackage = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as CliPackageManifest;

// The publishable package is the source of truth for runtime dependencies.
// Keeping every dependency external avoids silently bundling a newly-added
// native or optional runtime dependency when this list changes.
const external = Object.keys(cliPackage.dependencies ?? {}).sort();

export default defineConfig({
  entry: ['src/index.ts'],
  tsconfig: 'tsconfig.json',
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  external,
});
