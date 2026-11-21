import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

// ─── Build layout (ported from sentinel-node-manager-solana) ───
// Main + preload emit CommonJS (.cjs): Electron loads CJS from asar reliably.
// Main BUNDLES its runtime deps: electron-builder 25's packer re-nests deduplicated npm
// packages (it shipped @solana/options without the @solana/codecs-core it requires), so the
// packaged app must not resolve anything from node_modules. Only optional native addons
// (ws's bufferutil / utf-8-validate) stay external; ws falls back to pure JS without them.

const EXTERNALS_MAIN = ['electron', 'bufferutil', 'utf-8-validate'];

// K-M4-5: the UI test hooks (src/main/dev/ui-*) are built in only when DVPN_DEV_HOOKS is '1' (unpackaged runs) or
// 'packaged' (a VM UI-lane test installer). Release builds leave it unset: the hooks are not in out/main.
const DEV_HOOKS = ['1', 'packaged'].includes(process.env.DVPN_DEV_HOOKS ?? '') ? String(process.env.DVPN_DEV_HOOKS) : '';

export default defineConfig({
  main: {
    define: { __DVPN_DEV_HOOKS__: JSON.stringify(DEV_HOOKS) },
    // Anchor's ESM build keeps bare require("./workspace.js") calls the bundler cannot follow;
    // its CJS build (what Node's require() loads) bundles cleanly.
    resolve: {
      alias: [{ find: /^@coral-xyz\/anchor$/, replacement: resolve(__dirname, 'node_modules/@coral-xyz/anchor/dist/cjs/index.js') }],
    },
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        external: EXTERNALS_MAIN,
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
    build: {
      outDir: 'out/renderer',
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
    },
  },
});
