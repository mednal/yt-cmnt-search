/**
 * Extension build: three esbuild bundles plus the static files Chrome loads.
 *
 * `node scripts/build.mjs [--watch]`
 *
 * The backend origin is baked in here rather than read at runtime, because it
 * has to appear in two places that must agree: the panel's fetch calls and
 * the manifest's `host_permissions`. Set `YCA_API_BASE_URL` to point a build
 * at a different backend; `__API_ORIGIN__` in public/manifest.json is
 * replaced with its origin.
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

const apiBaseUrl = (process.env.YCA_API_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const apiOrigin = new URL(apiBaseUrl).origin;

/** One bundle per Chrome execution context — they share no global scope. */
const entryPoints = {
  'service-worker': 'src/background/service-worker.ts',
  'content-script': 'src/content/content-script.ts',
  sidepanel: 'src/sidepanel/sidepanel.ts',
};

const options = {
  absWorkingDir: root,
  entryPoints: Object.entries(entryPoints).map(([out, file]) => ({ in: file, out })),
  outdir,
  bundle: true,
  format: 'iife',
  // Matches manifest.minimum_chrome_version: the Side Panel API is 114+.
  target: 'chrome114',
  platform: 'browser',
  sourcemap: 'linked',
  logLevel: 'info',
  define: { __API_BASE_URL__: JSON.stringify(apiBaseUrl) },
};

async function copyStatic() {
  await cp(path.join(root, 'public'), outdir, {
    recursive: true,
    filter: (source) => path.basename(source) !== 'manifest.json',
  });

  const manifest = await readFile(path.join(root, 'public', 'manifest.json'), 'utf8');
  await writeFile(path.join(outdir, 'manifest.json'), manifest.replaceAll('__API_ORIGIN__', apiOrigin));
}

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await copyStatic();

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
  console.log(`watching — load ${outdir} at chrome://extensions (backend ${apiBaseUrl})`);
} else {
  await esbuild.build(options);
  console.log(`built ${outdir} (backend ${apiBaseUrl})`);
}
