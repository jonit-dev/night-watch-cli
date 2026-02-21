/**
 * esbuild bundling step for the Night Watch CLI.
 *
 * Runs AFTER `tsc --build && tsc-alias` have already compiled all workspace
 * packages to their respective `dist/` directories.  This script takes the
 * compiled `dist/cli.js` entry-point and bundles it into a single self-
 * contained file, inlining all workspace packages (@night-watch/core, /slack,
 * /server) as well as every pure-JS npm dependency.
 *
 * Only `better-sqlite3` is kept external because it ships a native .node
 * binary that cannot be bundled.
 */

import { cpSync, existsSync } from 'fs';

import * as esbuild from 'esbuild';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve `@night-watch/<pkg>` and `@night-watch/<pkg>/subpath.js` imports
 * to their pre-built dist files in the monorepo.
 */
const workspacePlugin = {
  name: 'night-watch-workspace',
  setup(build) {
    build.onResolve({ filter: /^@night-watch\// }, (args) => {
      // Split "@night-watch/core/notify.js" → ['', 'night-watch', 'core', 'notify.js']
      const segments = args.path.split('/');
      // segments[0] = '@night-watch' scope (empty because split on '/')
      // Actually: '@night-watch/core/notify.js'.split('/') = ['@night-watch', 'core', 'notify.js']
      const pkg = segments[1]; // 'core' | 'slack' | 'server'
      const rest = segments.slice(2); // [] or ['notify.js']

      const distDir = resolve(__dirname, `../${pkg}/dist`);
      const filePath = rest.length > 0 ? join(distDir, rest.join('/')) : join(distDir, 'index.js');

      return { path: filePath };
    });
  },
};

await esbuild.build({
  entryPoints: [resolve(__dirname, 'dist/cli.js')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: resolve(__dirname, 'dist/cli.js'),
  allowOverwrite: true,
  // Mark all npm packages (node_modules) as external — they are listed in
  // `dependencies` and installed by the end-user's npm/yarn.
  // Workspace packages (@night-watch/*) are resolved to absolute file paths
  // by the plugin below, so `packages: 'external'` does NOT affect them;
  // their code is inlined into the bundle.
  packages: 'external',
  plugins: [workspacePlugin],
  // tsyringe requires reflect-metadata to be imported before it loads.
  // esbuild re-orders ESM imports alphabetically, which puts tsyringe before
  // reflect-metadata.  Forcing a banner import ensures it runs first.
  banner: { js: `import 'reflect-metadata';` },
  // Keep the bundle readable for debugging; set to false to shrink size.
  minify: false,
  sourcemap: false,
  // Silence the "direct eval" warning; some deep deps use it.
  logOverride: { 'direct-eval': 'silent' },
});

console.log('Bundle complete: dist/cli.js');

// Copy web UI assets into the CLI dist so they ship with the npm package.
// The server resolves __dirname/web/ at runtime when no monorepo root is found.
const webSrc = resolve(__dirname, '../../web/dist');
const webDest = resolve(__dirname, 'dist/web');
if (existsSync(webSrc)) {
  cpSync(webSrc, webDest, { recursive: true });
  console.log('Web UI copied: dist/web/');
} else {
  console.warn('Warning: web/dist not found — web UI will not be bundled.');
}

// Copy shell scripts into dist/scripts/ so they are always available regardless
// of how the package is installed (global npm, nvm, volta, etc.).
// getScriptPath() checks dist/scripts/ first when running from the bundle.
const scriptsSrc = resolve(__dirname, '../../scripts');
const scriptsDest = resolve(__dirname, 'dist/scripts');
cpSync(scriptsSrc, scriptsDest, { recursive: true, dereference: true });
console.log('Scripts copied: dist/scripts/');

// Copy templates into dist/templates/ so bundled scripts can find them.
// Scripts reference ../templates/ relative to their location in dist/scripts/.
const templatesSrc = resolve(__dirname, '../../templates');
const templatesDest = resolve(__dirname, 'dist/templates');
cpSync(templatesSrc, templatesDest, { recursive: true, dereference: true });
console.log('Templates copied: dist/templates/');
