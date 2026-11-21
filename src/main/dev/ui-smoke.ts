// ─── UI smoke run (tests only; DVPN_UI_SMOKE=<dir>) ───
// Clicks every sidebar entry, saves a screenshot of each screen, writes
// renderer console errors to errors.json, then quits. Read-only: it never
// presses a button that signs, spends or changes settings.
import { app, type BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { log } from '../logger';
import { rpcCallCounts } from '../../core/chain/rpc';
import { trayActive } from '../system/tray';
import { runScenario } from './ui-scenario';
import { summariseFaults, type ScreenFaults } from '../../shared/i18n/faults';

const SCREENS = ['Connect', 'Servers', 'Plans', 'Activity', 'Node test', 'Wallet', 'Kill switch', 'Split tunnelling', 'Settings', 'Diagnostics', 'CLI'];
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Call before app ready: occlusion throttling would make capturePage return stale frames. */
export function prepareUiSmoke(): void {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  // DVPN_UI_SMOKE_DPI=1.5 renders at 150 % (P7: every screen at 100 % and 150 %).
  const dpi = Number(process.env.DVPN_UI_SMOKE_DPI ?? '');
  if (dpi > 0 && dpi <= 4) app.commandLine.appendSwitch('force-device-scale-factor', String(dpi));
}

async function uiConnect(win: BrowserWindow, target: string, shot: (n: string) => Promise<void>, errors: string[]): Promise<void> {
  const [node, basis = 'per_gb', sub = ''] = target.split(':');
  const js = (code: string): Promise<unknown> => win.webContents.executeJavaScript(code);
  const nav = (label: string): Promise<unknown> => js(`[...document.querySelectorAll('nav[data-main-nav] button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)})?.click()`);
  const until = async (code: string, ms: number): Promise<boolean> => {
    for (let t = 0; t < ms / 500; t++) { if (await js(code)) return true; await wait(500); }
    return false;
  };
  if (basis === 'plan') {
    // Plans -> subscription Servers -> roster Connect -> sheet (ticket, no deposit).
    await nav('Plans');
    if (!(await until(`!!document.querySelector('[data-roster="${sub}"]')`, 30_000))) { errors.push(`ui-connect: no subscription ${sub}`); return; }
    await js(`document.querySelector('[data-roster="${sub}"]').click()`);
    if (!(await until(`!!document.querySelector('[data-plan-connect="${node}"]:not([disabled])')`, 30_000))) { errors.push(`ui-connect: ${node} not connectable on the plan`); await shot('09-roster'); return; }
    await shot('09-roster');
    await js(`document.querySelector('[data-plan-connect="${node}"]').click()`);
    await wait(800);
  } else {
    await nav('Servers');
    // Country groups start collapsed; search for the address like a user would (it opens matches).
    await until(`!!document.querySelector('input[placeholder^="Search"]')`, 10_000);
    await js(`(() => { const i = document.querySelector('input[placeholder^="Search"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(node)});
      i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    if (!(await until(`!!document.querySelector('[data-connect="${node}"]:not([disabled])')`, 30_000))) { errors.push(`ui-connect: no enabled Connect for ${node}`); await shot('09-servers-search'); return; }
    await js(`document.querySelector('[data-connect="${node}"]').click()`);
    await wait(800);
    await js(`[...document.querySelectorAll('[role="radio"]')].find((b) => b.textContent.startsWith(${JSON.stringify(basis === 'per_hour' ? 'Per hour' : 'Per GB')}))?.click()`);
  }
  await wait(500);
  await shot('09-connect-sheet');
  await js(`document.querySelector('[data-connect-confirm]').click()`);
  await nav('Connect');
  if (!(await until(`!!document.querySelector('[data-disconnect]') && /Protected/.test(document.querySelector('main').textContent)`, 150_000))) {
    errors.push(`ui-connect: not Protected: ${String(await js(`(document.querySelector('main')?.textContent ?? '[no main layout: the setup screen is showing]').slice(0, 200)`))}`);
    await shot('10-connect-failed');
    return;
  }
  await wait(3000);
  await shot('10-connected');
  await js(`document.querySelector('[data-disconnect]').click()`);
  if (!(await until(`!document.querySelector('[data-disconnect]')`, 60_000))) errors.push('ui-connect: Disconnect did not finish');
  await wait(1500);
  await shot('11-disconnected');
}

export function runUiSmoke(win: BrowserWindow, dir: string): void {
  win.webContents.setBackgroundThrottling(false);
  fs.mkdirSync(dir, { recursive: true });
  const errors: string[] = [];
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(Number(process.env.DVPN_UI_SMOKE_WAIT_MS ?? 9000));
      // T5: what startup read, per source, before any click (each should be 1 unless retried).
      fs.writeFileSync(path.join(dir, 'rpc-startup.json'), JSON.stringify(rpcCallCounts(), null, 2));
      // DVPN_UI_SMOKE_THEME=dark|light forces a theme for the run (default: the OS's).
      const theme = process.env.DVPN_UI_SMOKE_THEME;
      if (theme === 'dark' || theme === 'light') await win.webContents.executeJavaScript(`document.documentElement.setAttribute('data-theme', '${theme}')`);
      // DVPN_UI_SMOKE_SIZE=<w>x<h> sets the window's content size (design checks at several widths).
      const size = /^(\d+)x(\d+)$/.exec(process.env.DVPN_UI_SMOKE_SIZE ?? '');
      // Below the 960x640 minimum too: Windows shrinks the window to a small screen anyway
      // (a 1366x768 laptop at 150 % leaves ~910x512), so the layout must hold there.
      if (size) { win.setMinimumSize(Math.min(960, Number(size[1])), Math.min(640, Number(size[2]))); win.setContentSize(Number(size[1]), Number(size[2])); await wait(600); }
      // The design rubric (scripts/ui-audit.js) runs on every screen when the file is present.
      // An installed app has no scripts/ folder: DVPN_UI_AUDIT_DIR points at a folder holding
      // ui-audit.js and axe.min.js (axe-core: WCAG 2 A/AA per screen -> axe.json).
      const auditDir = process.env.DVPN_UI_AUDIT_DIR;
      const auditPath = auditDir ? path.join(auditDir, 'ui-audit.js') : path.join(app.getAppPath(), 'scripts', 'ui-audit.js');
      const auditJs = fs.existsSync(auditPath) ? fs.readFileSync(auditPath, 'utf8') : '';
      const axePath = auditDir ? path.join(auditDir, 'axe.min.js') : '';
      const axeJs = axePath && fs.existsSync(axePath) ? fs.readFileSync(axePath, 'utf8') : '';
      const audits: unknown[] = [];
      const axe: unknown[] = [];
      const audit = async (): Promise<void> => {
        if (auditJs) {
          try { audits.push(await win.webContents.executeJavaScript(auditJs)); } catch (err) { errors.push(`ui audit failed: ${(err as Error).message}`); }
        }
        if (!axeJs) return;
        try {
          if (!(await win.webContents.executeJavaScript('typeof window.axe === "object"'))) await win.webContents.executeJavaScript(axeJs);
          axe.push(await win.webContents.executeJavaScript(`(async () => {
            const screen = (document.querySelector('nav[data-main-nav] [aria-current="page"]')?.textContent ?? 'setup').trim();
            const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] });
            return { screen, violations: r.violations.map((x) => ({ id: x.id, impact: x.impact, help: x.help, nodes: x.nodes.length, targets: x.nodes.slice(0, 4).map((n) => n.target.join(' ')) })) };
          })()`));
        } catch (err) { errors.push(`axe failed: ${(err as Error).message}`); }
      };
      const shot = async (name: string): Promise<void> => {
        // Wait two animation frames in the page, then capture twice: the first
        // capture can return the previous compositor frame.
        await win.webContents.executeJavaScript('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
        win.webContents.invalidate();
        await win.webContents.capturePage();
        await wait(400);
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
        // i18n (plan B7): clipped / cut / off-window text, and in en-XL text that skipped tr(), per picture
        try { faults.push(await win.webContents.executeJavaScript(`window.__i18nFaults ? window.__i18nFaults(${JSON.stringify(name)}) : null`)); } catch (err) { errors.push(`i18n faults failed on ${name}: ${(err as Error).message}`); }
      };
      const faults: unknown[] = [];
      const writeFaults = (): void => {
        const rows = faults.filter(Boolean) as ScreenFaults[];
        fs.writeFileSync(path.join(dir, 'i18n-faults.json'), JSON.stringify(rows, null, 2));
        fs.writeFileSync(path.join(dir, 'i18n-faults.txt'), summariseFaults(rows).join('\n') + '\n');
      };
      // DVPN_UI_GALLERY=1: shoot the component gallery (UI-165), section by section, with each dialog
      // open, and stop. Needs no wallet and no VPN service, so it runs on any machine.
      if (process.env.DVPN_UI_GALLERY === '1') {
        const js = (code: string): Promise<unknown> => win.webContents.executeJavaScript(code);
        await js(`window.location.hash = '#gallery'`);
        await wait(1200);
        const ids = (await js(`[...document.querySelectorAll('[data-gallery-section]')].map((e) => e.getAttribute('data-gallery-section'))`)) as string[];
        if (!ids.length) errors.push('gallery: no section rendered');
        for (const [i, id] of ids.entries()) {
          await js(`document.querySelector('[data-gallery-section="${id}"]').scrollIntoView({ block: 'start' })`);
          await wait(300);
          await shot(`g${String(i + 1).padStart(2, '0')}-${id}`);
          await audit();
        }
        for (const d of ['sheet', 'confirm', 'confirm-fail']) {
          await js(`document.querySelector('[data-gallery-open="${d}"]')?.click()`);
          await wait(500);
          if (d === 'confirm-fail') { await js(`document.querySelector('[data-confirm-modal] [data-autofocus]')?.click()`); await wait(500); }
          if (!(await js(`!!document.querySelector('[data-sheet]')`))) errors.push(`gallery: dialog ${d} did not open`);
          await shot(`g9-dialog-${d}`);
          // Esc must close every dialog (UI-025).
          await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
          await wait(400);
          if (await js(`!!document.querySelector('[data-sheet]')`)) errors.push(`gallery: Esc did not close dialog ${d}`);
        }
        // Notifications: three tones at once, then the same one twice (must merge into one with a count).
        await js(`document.querySelector('[data-gallery-section="notifications"]').scrollIntoView({ block: 'start' })`);
        await js(`document.querySelector('[data-gallery-toast="all"]').click()`);
        await js(`document.querySelector('[data-gallery-toast="repeat"]').click(); document.querySelector('[data-gallery-toast="repeat"]').click()`);
        await wait(600);
        const toasts = (await js(`({ shown: document.querySelectorAll('[data-toast]').length, more: document.querySelector('[data-toasts-more]')?.getAttribute('data-toasts-more') ?? '0', errors: document.querySelectorAll('[data-toast="error"]').length })`)) as { shown: number; more: string; errors: number };
        if (toasts.shown !== 3 || toasts.more !== '1' || toasts.errors !== 1) errors.push(`gallery: notifications ${JSON.stringify(toasts)} (want 3 shown, 1 more, the error among them)`);
        await shot('g9-notifications');
        // After 9 s the passing ones are gone and the error is still there (UI-032).
        await wait(9000);
        const left = (await js(`[...document.querySelectorAll('[data-toast]')].map((e) => e.getAttribute('data-toast')).join(',')`)) as string;
        if (left !== 'error') errors.push(`gallery: after 9 s notifications left = "${left}" (want only the error)`);
        await shot('g9-notifications-later');
        // The Connect screen, replayed through every stage on one mounted screen (UI-003): the hero's
        // label, title, detail and action row must sit at the same place in every stage.
        const stages = ['idle', 'ready', 'deposit', 'connecting', 'checking', 'protected', 'leaking', 'reconnecting', 'switching', 'problem', 'blocked'];
        await js(`document.querySelectorAll('[data-toast-dismiss]').forEach((b) => b.click())`);
        const boxes: Array<Record<string, unknown>> = [];
        for (const [i, id] of stages.entries()) {
          await js(`window.location.hash = '#gallery/connect/${id}'`);
          await wait(1100); // past the 700 ms minimum display time
          const box = (await js(`(() => {
            const hero = document.querySelector('[data-stage][data-stage-step]');
            if (!hero) return null;
            const top = (el) => (el ? Math.round(el.getBoundingClientRect().top) : null);
            const card = hero.closest('.card-raised');
            return { stage: hero.getAttribute('data-stage'), listTop: top(document.querySelector('[data-quick-pick]')), heroTop: top(card), heroHeight: card ? Math.round(card.getBoundingClientRect().height) : null,
              labelTop: top(hero.firstElementChild), titleTop: top(hero.querySelector('[data-hero-title]')?.parentElement), actionsTop: top(hero.lastElementChild),
              title: hero.querySelector('[data-hero-title]')?.textContent, card: document.querySelector('[data-sidebar-session]')?.getBoundingClientRect().height };
          })()`)) as Record<string, unknown> | null;
          if (!box) { errors.push(`connect preview ${id}: no hero`); continue; }
          boxes.push({ id, ...box });
          await shot(`c${String(i + 1).padStart(2, '0')}-${id}`);
        }
        fs.writeFileSync(path.join(dir, 'connect-layout.json'), JSON.stringify(boxes, null, 2));
        // The Connect dialog for a new deposit: the button names the amount and never says "lock" (UI-044).
        await js(`window.location.hash = '#gallery/sheet/new'`);
        await wait(900);
        const confirm = String(await js(`document.querySelector('[data-connect-confirm]')?.textContent ?? ''`));
        if (!/^Connect and deposit [\d.,]+ tDVPN$/.test(confirm.trim())) errors.push(`connect dialog: button reads "${confirm}"`);
        if (await js(`/\\block(ed)?\\b|open deposit|nodes?\\b/i.test(document.querySelector('[data-connect-sheet]')?.textContent ?? '')`)) errors.push('connect dialog: an old word (lock, open deposit, node) is on screen');
        await shot('c20-connect-dialog');
        // The Node test page in its six made-up states (rows 144, 149-156).
        for (const [i, id] of ['empty', 'picked', 'low-limit', 'running', 'finished', 'unfinished'].entries()) {
          await js(`window.location.hash = '#gallery/nodetest/${id}'`);
          await wait(900);
          const got = await js(`document.querySelector('[data-gallery-nodetest]')?.getAttribute('data-gallery-nodetest') ?? null`);
          if (got !== id) errors.push(`node test preview ${id}: page shows ${String(got)}`);
          await shot(`n${i + 1}-nodetest-${id}`);
        }
        // Wallet with refunds ready, beside the real sidebar bottom (owner 2026-11-15): the Claim refunds
        // button, the Devnet strip, and a tooltip opened at two places, each inside the window whole.
        await js(`window.location.hash = '#gallery/wallet'`);
        await wait(900);
        if (!(await js(`!!document.querySelector('[data-claim-refunds]')`))) errors.push('wallet preview: no Claim refunds button');
        if (!(await js(`!!document.querySelector('[data-gallery-sidebar-foot] .devnet-badge')`))) errors.push('wallet preview: no Devnet strip in the sidebar');
        // The strip's second half ("Test tokens only") must show whole, never cut to "Test tokens …".
        if (await js(`(() => { const s = document.querySelector('[data-gallery-sidebar-foot] .devnet-badge .truncate'); return !s || s.scrollWidth > s.clientWidth; })()`)) errors.push('wallet preview: the Devnet strip text is cut off');
        await shot('w1-wallet-claim-refunds');
        const helps = Number(await js(`document.querySelectorAll('[data-gallery-wallet] [data-help] button').length`));
        for (const [n, at] of [[1, helps - 1], [2, 0]] as const) {
          await js(`document.querySelectorAll('[data-gallery-wallet] [data-help] button')[${at}]?.click()`); // a click: focus events do not fire in a window that is not in front
          await wait(400);
          const tip = (await js(`(() => { const t = document.querySelector('[data-tooltip]'); if (!t) return null; const r = t.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: innerWidth, h: innerHeight, body: t.parentElement === document.body }; })()`)) as { l: number; t: number; r: number; b: number; w: number; h: number; body: boolean } | null;
          if (!tip) errors.push(`wallet preview: tooltip ${n} did not open`);
          else if (!tip.body || tip.l < 0 || tip.t < 0 || tip.r > tip.w || tip.b > tip.h) errors.push(`wallet preview: tooltip ${n} is cut off or not on top: ${JSON.stringify(tip)}`);
          await shot(`w${n + 1}-wallet-tooltip-${n}`);
          await js(`window.dispatchEvent(new Event('scroll'))`); // closes it (the same way a page scroll does)
          await wait(200);
        }
        // Banners above the hero may move it as a whole (UI-010, open); inside the hero nothing may move.
        for (const k of ['heroHeight']) {
          const seen = [...new Set(boxes.map((b) => b[k]))];
          if (seen.length > 1) errors.push(`connect layout: ${k} differs between stages: ${JSON.stringify(boxes.map((b) => [b.id, b[k]]))}`);
        }
        const inner = [...new Set(boxes.map((b) => `${Number(b.labelTop) - Number(b.heroTop)}/${Number(b.titleTop) - Number(b.heroTop)}/${Number(b.actionsTop) - Number(b.heroTop)}`))];
        if (inner.length > 1) errors.push(`connect layout: label/title/actions move inside the hero: ${JSON.stringify(inner)}`);
        // UI-008: from the first stage of a connect to Protected, the list under the session rows does not move.
        const run = boxes.filter((b) => ['ready', 'deposit', 'connecting', 'checking', 'protected'].includes(String(b.id)));
        const lists = [...new Set(run.map((b) => b.listTop))];
        if (lists.length > 1) errors.push(`connect layout: the page under the hero moves during a connect: ${JSON.stringify(run.map((b) => [b.id, b.listTop]))}`);
        // The status card has one height in every stage but the blocked one, which adds its button (UI-016).
        const cards = [...new Set(boxes.filter((b) => b.id !== 'blocked').map((b) => b.card))];
        if (cards.length > 1) errors.push(`status card height differs between stages: ${JSON.stringify(boxes.map((b) => [b.id, b.card]))}`);
        if (auditJs) fs.writeFileSync(path.join(dir, 'audit.json'), JSON.stringify(audits, null, 2));
        writeFaults();
        fs.writeFileSync(path.join(dir, 'errors.json'), JSON.stringify(errors, null, 2));
        return;
      }
      // F2.1: the welcome screen comes first every launch; shoot it, then Continue.
      const welcome = await win.webContents.executeJavaScript('!!document.querySelector("[data-welcome-continue]")');
      if (welcome) {
        await shot('00-welcome');
        await audit();
        await win.webContents.executeJavaScript('document.querySelector("[data-welcome-continue]").click()');
        await wait(1200);
      }
      // DVPN_UI_ONBOARD=1 (uifire onboarding cells, fresh profile): the scenario drives the setup
      // screen itself, so it runs here, before (and instead of) the main-screen walk.
      const onboardSteps = process.env.DVPN_UI_ONBOARD === '1' ? process.env.DVPN_UI_SCENARIO : '';
      if (onboardSteps) {
        await shot('00-onboarding');
        const res = await runScenario(win, dir, onboardSteps, shot);
        for (const r of res) if (!r.ok) errors.push(`scenario ${r.step}: ${r.detail}`);
      }
      // Setup steps clear as the first service, wallet and permission reads land (seconds on a
      // cold VM); checking once 1.2 s after Continue skipped the whole run with no error
      // (ddv-win-a 2026-10-22). Wait up to 60 s, then say which step held it.
      let onMain = !!onboardSteps; // an onboarding run ends here: no screen walk after it
      for (let t = 0; t < 120 && !onMain; t++) {
        onMain = Boolean(await win.webContents.executeJavaScript('!!document.querySelector(\'nav[data-main-nav]\')'));
        if (!onMain) await wait(500);
      }
      if (!onMain) {
        await shot('00-onboarding');
        // The onboarding pass (P7) needs the rubric + axe on this screen too, or it passes with 0 audited.
        await audit();
        const held = String(await win.webContents.executeJavaScript('document.querySelector("[data-onboarding-step]")?.getAttribute("data-onboarding-step") ?? "unknown"'));
        errors.push(`setup screen still showing after 60 s (step: ${held}): no screen was walked`);
      } else if (!onboardSteps) {
        for (const [i, label] of SCREENS.entries()) {
          const clicked = await win.webContents.executeJavaScript(`(() => { const b = [...document.querySelectorAll('nav[data-main-nav] button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (b) b.click(); return !!b; })()`);
          if (!clicked) errors.push(`nav button missing: ${label}`);
          // Servers waits for the 6 s probe timeout so results are on screen.
          await wait(label === 'Servers' ? 10_000 : label === 'Diagnostics' ? 5000 : 1800);
          // A busy renderer (first probes) can lag the click; wait until the screen really changed.
          for (let t = 0; t < 40; t++) {
            const cur = String(await win.webContents.executeJavaScript(`(document.querySelector('nav[data-main-nav] [aria-current="page"]')?.textContent ?? '').trim()`));
            if (cur === label) break;
            await wait(250);
          }
          // Diagnostics: the service + driver checks can outlast the 5 s on a slow (nested) VM, and a
          // shot of the "Checking…" placeholders reads as a half-empty page. Wait up to 30 s more.
          if (label === 'Diagnostics') {
            for (let t = 0; t < 60; t++) {
              if (!(await win.webContents.executeJavaScript(`(document.querySelector('main')?.textContent ?? '').includes('Checking…')`))) break;
              await wait(500);
            }
          }
          const shown = await win.webContents.executeJavaScript(`(document.querySelector('nav[data-main-nav] [aria-current="page"]')?.textContent ?? '').trim() + ' | ' + (document.querySelector('main h1')?.textContent ?? '')`);
          if (!String(shown).startsWith(label)) errors.push(`expected ${label}, showing ${shown}`);
          await shot(`${String(i + 1).padStart(2, '0')}-${label.toLowerCase()}`);
          await audit();
          if (label === 'CLI') {
            // Prove the terminal really runs commands: click Run on `version`, read the output.
            await win.webContents.executeJavaScript(`document.querySelector('[data-run="version"]')?.click()`);
            await wait(2500);
            const term = String(await win.webContents.executeJavaScript(`document.querySelector('[role="log"]')?.textContent ?? ''`));
            if (!term.includes('$ version') || !/network devnet/i.test(term.split('$ version')[1] ?? '')) errors.push(`cli terminal did not run version: ${term.slice(-200)}`);
            await shot(`${String(i + 1).padStart(2, '0')}-cli-ran`);
          }
        }
        // Opt-in, SPENDS: DVPN_UI_SMOKE_CONNECT=<node>:<per_gb|per_hour> clicks through a real
        // connect and disconnect. Only for a rig whose tunnel cannot touch this machine (box netns).
        const target = process.env.DVPN_UI_SMOKE_CONNECT;
        if (target) await uiConnect(win, target, shot, errors);
        // DVPN_UI_SCENARIO=<steps>: the matrix cells driven through the real screens (ui-scenario.ts).
        const steps = process.env.DVPN_UI_SCENARIO;
        if (steps) {
          const res = await runScenario(win, dir, steps, shot);
          for (const r of res) if (!r.ok) errors.push(`scenario ${r.step}: ${r.detail}`);
        }
      }
      if (auditJs) fs.writeFileSync(path.join(dir, 'audit.json'), JSON.stringify(audits, null, 2));
      if (axeJs) fs.writeFileSync(path.join(dir, 'axe.json'), JSON.stringify(axe, null, 2));
      writeFaults();
      fs.writeFileSync(path.join(dir, 'rpc-end.json'), JSON.stringify(rpcCallCounts(), null, 2));
      // T21: closing the window hides it to the tray (app keeps running); the tray's Open shows it.
      const desktop = { trayActive: trayActive(), hiddenOnClose: false, aliveAfterClose: false, shownAgain: false };
      win.close();
      await wait(1200);
      desktop.aliveAfterClose = !win.isDestroyed();
      desktop.hiddenOnClose = desktop.aliveAfterClose && !win.isVisible();
      if (desktop.aliveAfterClose) { win.showInactive(); await wait(800); desktop.shownAgain = win.isVisible(); }
      if (!desktop.trayActive || !desktop.hiddenOnClose || !desktop.shownAgain) errors.push(`desktop: ${JSON.stringify(desktop)}`);
      // A second launch started now (DVPN_UI_SMOKE_HOLD_MS) must hand over to this window and exit.
      await wait(Number(process.env.DVPN_UI_SMOKE_HOLD_MS ?? 0));
      fs.writeFileSync(path.join(dir, 'desktop.json'), JSON.stringify(desktop, null, 2));
      fs.writeFileSync(path.join(dir, 'errors.json'), JSON.stringify(errors, null, 2));
    } catch (err) {
      log.error('ui smoke failed', err);
      fs.writeFileSync(path.join(dir, 'errors.json'), JSON.stringify([...errors, `smoke crashed: ${(err as Error).message}`], null, 2));
    } finally {
      app.exit(0);
    }
  });
}
