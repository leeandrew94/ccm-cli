import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { ccm: 'src/cli.ts' },
  outDir: 'bin',
  format: ['esm'],
  target: 'node18',
  clean: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
});
