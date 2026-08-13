/**
 * Build: src/plugin/main.ts -> dist/code.js, and src/ui/bootstrap.ts +
 * src/ui/styles.css inlined into dist/ui.html (Figma requires a single
 * self-contained HTML file).
 *
 *   node build.mjs           one-shot build
 *   node build.mjs --watch   rebuild on change
 *   node build.mjs --test    bundle the testable modules to dist-test/
 */
import { build, context } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not `new URL(...).pathname`: the latter keeps percent-encoding
// and produces a leading-slash drive path on Windows, so a checkout in a folder
// with a space in it — or any checkout on Windows — failed to build.
const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

const PLUGIN_ENTRY = path.join(root, 'src/plugin/main.ts');
const UI_ENTRY = path.join(root, 'src/ui/bootstrap.ts');
const UI_HTML = path.join(root, 'src/ui/ui.html');
const UI_CSS = path.join(root, 'src/ui/styles.css');

fs.mkdirSync(dist, { recursive: true });

const shared = {
  bundle: true,
  target: 'es2017',
  format: 'iife',
  legalComments: 'none',
  logLevel: 'info',
};

async function buildUi() {
  const result = await build({
    ...shared,
    entryPoints: [UI_ENTRY],
    write: false,
    logLevel: 'silent',
  });
  const js = result.outputFiles[0].text;
  const css = fs.readFileSync(UI_CSS, 'utf8');
  const html = fs.readFileSync(UI_HTML, 'utf8');

  // Function replacements: `$&` and friends inside CSS/JS must stay literal.
  const out = html
    .replace('<!--INJECT_CSS-->', () => '<style>\n' + css + '\n</style>')
    .replace('<!--INJECT_JS-->', () => '<script>\n' + js + '\n</script>');

  fs.writeFileSync(path.join(dist, 'ui.html'), out);
}

const uiWatchPlugin = {
  name: 'ui-html',
  setup(b) {
    b.onEnd(async () => {
      await buildUi();
      console.log('[build] dist/ui.html');
    });
  },
};

/* `npm test` bundles the environment-free modules as ESM so node --test can
   import them without a TypeScript loader. */
if (process.argv.includes('--test')) {
  await build({
    ...shared,
    format: 'esm',
    platform: 'neutral',
    entryPoints: [path.join(root, 'test/entry.ts')],
    outfile: path.join(root, 'dist-test/lib.mjs'),
    logLevel: 'silent',
  });
  console.log('[build] dist-test/lib.mjs');
} else if (watch) {
  const codeCtx = await context({
    ...shared,
    entryPoints: [PLUGIN_ENTRY],
    outfile: path.join(dist, 'code.js'),
  });
  const uiCtx = await context({
    ...shared,
    entryPoints: [UI_ENTRY],
    write: false,
    logLevel: 'silent',
    plugins: [uiWatchPlugin],
  });
  await codeCtx.watch();
  await uiCtx.watch();

  // esbuild only watches the module graph, and neither the template nor the
  // stylesheet is imported by it.
  for (const file of [UI_HTML, UI_CSS]) {
    fs.watchFile(file, { interval: 200 }, async () => {
      await buildUi();
      console.log('[build] dist/ui.html (' + path.basename(file) + ')');
    });
  }

  console.log('[build] watching…');
} else {
  await build({
    ...shared,
    entryPoints: [PLUGIN_ENTRY],
    outfile: path.join(dist, 'code.js'),
    logLevel: 'silent',
  });
  await buildUi();
  console.log('[build] dist/code.js + dist/ui.html');
}
