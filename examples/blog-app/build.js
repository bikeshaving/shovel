#!/usr/bin/env bun
import { build } from 'esbuild';
import { staticFilesPlugin } from '@b9g/staticfiles/plugin';

await build({
  entryPoints: ['src/app.js'],
  bundle: true,
  outdir: 'dist',
  format: 'esm',
  target: 'es2022',
  plugins: [
    staticFilesPlugin({
      publicPath: '/static/',
      outputDir: 'dist/static',
      manifest: 'dist/static-manifest.json'
    })
  ],
  external: ['@b9g/*'] // Keep Shovel packages external for SSG
});

console.log('✅ Built app with static files');