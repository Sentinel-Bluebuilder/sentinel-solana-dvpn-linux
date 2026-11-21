// ─── Test hooks in the app: built in only on request (K-M4-5, review audit) ───
// dev/ui-smoke + dev/ui-scenario drive the real app from env vars (taskkill, CLI runs, spends, renderer JS from
// DVPN_UI_AUDIT_DIR). They were bundled into every installed app, so the env vars alone armed them. Now the
// build decides: __DVPN_DEV_HOOKS__ is replaced at build time from DVPN_DEV_HOOKS (electron.vite.config.ts):
//   ''         every release build: the hooks are not in the bundle and every DVPN_UI_* var is ignored;
//   '1'        a dev build: armed only when the app is NOT packaged (electron . / electron-vite dev);
//   'packaged' a test installer for the VM UI lanes (scripts/e2e/vm-ui-*.ps1): armed in the packaged app too.
// index.ts tests the literal itself, so a release bundle drops the dynamic import and its chunk.
declare const __DVPN_DEV_HOOKS__: string | undefined;

/** What this build was made with ('' when the build did not define it, as in unit tests). */
export const DEV_HOOKS_BUILD: string = typeof __DVPN_DEV_HOOKS__ === 'string' ? __DVPN_DEV_HOOKS__ : '';

/** True when this build may arm the UI test hooks. */
export function devHooksArmed(packaged: boolean, build: string = DEV_HOOKS_BUILD): boolean {
  if (build === 'packaged') return true;
  return build === '1' && !packaged;
}

/** process.env.DVPN_UI_SMOKE, but only in a build whose hooks are armed (ipc.ts, notify.ts). */
export function uiSmokeEnv(packaged: boolean, build: string = DEV_HOOKS_BUILD): string {
  return devHooksArmed(packaged, build) ? (process.env.DVPN_UI_SMOKE ?? '') : '';
}
