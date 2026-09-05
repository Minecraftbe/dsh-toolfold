/**
 * dsh-toolfold build — tsdown config.
 *
 * TWO source graphs, THREE artifacts, all under a gitignored lib/:
 *
 *   src/client/*.js (CommonJS — see the scoped package.json) bundles into
 *   TWO browser artifacts, mirroring how DSH's own client packages are
 *   built (cf. packages/client/tsdown.client.ts):
 *
 *   lib/client.js        — installed loader artifact. Served to the browser
 *                          through exports["./client"] and the client-modules
 *                          scan (dsh.client.platform: 'web'). The wrapper
 *                          registers the bundle exactly like DSH's tsdown
 *                          output: window.__ModuleLoader__.load({ id,
 *                          factory }) with the plugin as module.exports.
 *   lib/dynamic-body.js  — dynamic-runner body for live GUI sessions /
 *                          tools/live-probe.mjs: the SAME bundle, emitted
 *                          without the loader wrapper so its text can be
 *                          evaluated as `async () => { … }`, ending with
 *                          `return module.exports;`.
 *
 *   src/host/index.js (ESM — matches the root "type": "module", no scoped
 *   package.json needed) bundles into ONE node artifact:
 *
 *   lib/index.js         — host half (package main / exports["."], the
 *                          plugin row's entry). Plain ESM in, plain ESM out:
 *                          no transform is needed, but routing it through
 *                          the same build keeps lib/ 100% generated and the
 *                          edit loop uniform (edit src/ → pnpm build).
 *                          schemastery stays external (peer dependency) and
 *                          node: builtins stay external (platform: 'node').
 *
 * React is never imported by the client source (the settings card uses
 * hooks, so it must use the host's React instance). The wrapper intro
 * seeds whichever instance a channel provides — the loader's
 * `require('react')` in the installed channel, the runner's closure
 * `React` parameter in the dynamic channel — into
 * globalThis.__dshToolfoldReact, which src/client/react-env.js reads back
 * at card-registration/render time. Headless harnesses provide neither
 * and simply never register the card.
 *
 * Build:  pnpm build  (tsdown; devDependency — `pnpm install` provides it,
 *           `prepare` runs the build before pack/publish)
 */
const wrapper = [
  'var module = { exports: {} };',
  'var __dshSeed = null;',
  'try { if (typeof require === "function") __dshSeed = require("react"); } catch (err) { __dshSeed = null; }',
  'if (__dshSeed === null && typeof React !== "undefined") __dshSeed = React;',
  'if (typeof globalThis !== "undefined") globalThis.__dshToolfoldReact = __dshSeed;',
].join('\n');

const base = {
  entry: { client: './src/client/index.js' },
  outDir: './lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  dts: false,
  sourcemap: true,
  clean: false, // three entries share one outDir — never let one wipe the others
};

// The entry assigns module.exports = plugin directly; keep that shape (no
// __esModule interop wrapper) — the loader/runner return module.exports.
const noInterop = { esModule: false };

export default [
  {
    ...base,
    name: 'dsh-toolfold/client',
    outputOptions: {
      ...noInterop,
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({\n\tid: "dsh-toolfold",\n\tfactory: (require) => {\n',
      intro: wrapper,
      footer: '\t\treturn module.exports;\n\t}\n});',
    },
  },
  {
    ...base,
    name: 'dsh-toolfold/dynamic-body',
    outputOptions: {
      ...noInterop,
      entryFileNames: 'dynamic-body.js',
      banner: '',
      intro: wrapper,
      footer: '\nreturn module.exports;',
    },
  },
  {
    name: 'dsh-toolfold/host',
    entry: { index: './src/host/index.js' },
    outDir: './lib',
    format: 'esm',
    platform: 'node',
    target: 'es2020',
    dts: false,
    sourcemap: true,
    clean: false, // shares outDir with the browser entries — never wipe it
    // schemastery is a peer dependency: keep the bare import so the host
    // resolves the deployment's own copy (bundling it would shadow the
    // shared schema runtime and bloat the artifact).
    deps: { neverBundle: ['schemastery'] },
    outputOptions: {
      entryFileNames: 'index.js',
    },
  },
];
