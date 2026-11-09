// ─── UI scenario driver (tests only; DVPN_UI_SMOKE=<dir> + DVPN_UI_SCENARIO=<steps>) ───
// Drives the REAL screens like a person would, so every matrix cell the CLI proves is also
// proved in the app (RELEASE-TEST-PLAN Phase P / 5b). Steps are `;`-separated:
//   connect=<node>:<per_gb|per_hour>   Servers → search → Connect → sheet → confirm → connected and IP checked
//   coverage=<device|proxy-apps|proxy-only|leaking>  what the Connect screen claims (data-coverage)
//   egress-edge=node|direct            alias of egress-sysproxy on Linux (headless Chrome follows the GNOME proxy)
//   connect-start=<node>:<basis>       the same, but only until the sheet is confirmed (does not wait to connect)
//   cancel-connect=<regex>:<seconds>   once the Connect screen shows <regex> (e.g. Paying deposit), press its Cancel
//   hold-port=<n> / free-port=<n>      this app holds 127.0.0.1:<n> open, so the protocol cannot bind it
//   absent=<regex>                     the current screen (and its toasts) does NOT show it
//   disconnect                         Disconnect button, wait until gone
//   egress=node|direct                 system traffic (curl, no proxy) exits there
//   egress-socks=node                  through the session SOCKS shown on screen
//   egress-sysproxy=node|direct        a system-proxy app (headless Chrome reading the GNOME proxy)
//   proxy=on|off                       the "Send apps through the VPN now" checkbox (Split tunnelling)
//   browser                            "Open browser through VPN" → a browser process with our flags
//   restore                            the Restore network button (banner) or Diagnostics
//   ks-mode=off|on|persist             Kill switch page mode (+ Always confirm) and Apply
//   ks-state=blocking|armed|standby|off  what the Kill switch page shows (waits)
//   kill-proc=<name>[:noleakcheck]     taskkill the protocol process (VM only); noleakcheck = kill switch off on purpose
//   egress=none                        nothing gets out (kill switch blocking)
//   split-mode=off|include|exclude     Split tunnelling mode radio
//   split-app=<app name>:on|off        tick an app in the Split tunnelling list
//   split-route=<range>:on|off         add (Add button) or remove (×) an address or range there
//   split-apply                        press Apply there and wait until the service restarted
//   check=<css checkbox>:on|off        set any checkbox by clicking it
//   fill=<aria-label>:<text>           type text into the input with that aria-label (e.g. Other device address)
//   nav=<sidebar label>                go to a screen
//   click=<css selector>|text:<label>  click an element on the screen (button audit)
//   count=<css selector>:<min>         at least <min> elements match
//   expect=<regex>                     visible text on the current screen matches
//   shot=<name>                        screenshot
//   cli=<args>                         run the installed CLI while the app is open (exit 0 = ok)
//   wait-text=<regex>:<seconds>        the screen shows it within that time
//   sleep=<seconds>                    wait
//   gone=<css selector>:<seconds>      nothing matches within that time
//   signal=<name> / await=<name>:<s>   hand-off files with the VM harness (C:/ddv/sig)
// Writes scenario.json: each step, ok, detail, and every banner / toast text visible after it.
// SPENDS (connect): only on a throwaway VM, never on the owner's laptop.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Hand-off files between the scenario and the VM harness (signal / await steps). */
const SIG_DIR = process.env.DVPN_UI_SIG_DIR || (process.platform === 'win32' ? 'C:\\ddv\\sig' : '/tmp/ddv-sig');

/** The bundled CLI, run like bin\devnet-dvpn.cmd does (this exe as Node + out/cli), with this
 *  process's env (key file, data dir): a separate process, as a person's terminal would be. */
function runCli(args: string[], ms = 240_000): Promise<{ code: number; out: string }> {
  const cli = path.join(process.resourcesPath, 'app.asar', 'out', 'cli', 'devnet-dvpn.cjs');
  return new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], { timeout: ms, windowsHide: true, maxBuffer: 4 << 20, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0;
      resolve({ code, out: `${String(stdout)}\n${String(stderr)}`.trim() });
    });
  });
}

function run(file: string, args: string[], ms = 20_000, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: ms, env }, (err, stdout) => resolve(err && !stdout ? '' : String(stdout).trim()));
  });
}
const curl = (extra: string[] = []): Promise<string> => run('curl', ['-s', '-m', '12', ...extra, 'https://api.ipify.org']);
// Chrome on a GNOME session takes its proxy from gsettings (XDG_CURRENT_DESKTOP decides).
const sysproxyApp = async (): Promise<string> => {
  const dom = await run('google-chrome', ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=/tmp/ddv-oracle-${process.pid}`, '--dump-dom', 'https://api.ipify.org'], 40_000,
    { ...process.env, XDG_CURRENT_DESKTOP: 'GNOME' });
  return /\b(\d{1,3}(?:\.\d{1,3}){3})\b/.exec(dom)?.[1] ?? 'none';
};
const browserProcs = async (): Promise<string> => String((await run('pgrep', ['-f', 'proxy-server=socks5://127.0.0.1'])).split('\n').filter(Boolean).length);


export interface StepResult { step: string; ok: boolean; detail: string; visible: string[] }

const heldPorts = new Map<number, import('node:net').Server>();

export async function runScenario(win: BrowserWindow, dir: string, steps: string, shot: (n: string) => Promise<void>): Promise<StepResult[]> {
  const js = (code: string): Promise<unknown> => win.webContents.executeJavaScript(code);
  const nav = (label: string): Promise<unknown> => js(`[...document.querySelectorAll('nav[aria-label="Main"] button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)})?.click()`);
  const until = async (code: string, ms: number): Promise<boolean> => {
    for (let t = 0; t < ms / 500; t++) { if (await js(code)) return true; await wait(500); }
    return false;
  };
  const visible = async (): Promise<string[]> => (await js(`[...document.querySelectorAll('[role="alert"], [role="status"], .banner, [data-toast]')].map((e) => e.textContent.trim()).filter(Boolean)`)) as string[];
  const nodeIp = process.env.DVPN_UI_EXPECT_NODE_IP ?? '';
  // The test's own direct IP when given (the app may start during a tunnel, -Adopt).
  const direct = process.env.DVPN_UI_DIRECT_IP || await curl();
  // 'none' = no answer at all (the kill switch is blocking): curl() returns '' on failure.
  const want = (w: string): string => (w === 'node' ? nodeIp : w === 'none' ? '' : direct);
  const out: StepResult[] = [];

  for (const [i, raw] of steps.split(';').map((s) => s.trim()).filter(Boolean).entries()) {
    const [name, arg = ''] = raw.split('=');
    let ok = false;
    let detail = '';
    try {
      switch (name) {
        case 'connect-start':
        case 'connect': {
          const [node, basis = 'per_gb'] = arg.split(':');
          // Retry the sidebar click: right after a service restart (Apply) the first click can be lost,
          // and typing into another page's search box would test nothing (VM 2026-10-22).
          let onServers = false;
          for (let t = 0; t < 3 && !onServers; t++) {
            await nav('Servers');
            onServers = await until(`!!document.querySelector('input[aria-label="Search servers"]')`, 10_000);
          }
          if (!onServers) { detail = 'Servers screen did not open'; break; }
          await js(`(() => { const i = document.querySelector('input[aria-label="Search servers"]');
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(node)});
            i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
          if (!(await until(`!!document.querySelector('[data-connect="${node}"]:not([disabled])')`, 30_000))) { detail = 'no enabled Connect button'; break; }
          await js(`document.querySelector('[data-connect="${node}"]').click()`);
          await wait(800);
          await js(`[...document.querySelectorAll('[role="radio"]')].find((b) => b.textContent.startsWith(${JSON.stringify(basis === 'per_hour' ? 'Per hour' : 'Per GB')}))?.click()`);
          await wait(400);
          await js(`document.querySelector('[data-connect-confirm]').click()`);
          await nav('Connect');
          if (name === 'connect-start') { ok = await until(`!!document.querySelector('[data-cancel-connect]')`, 30_000); detail = ok ? 'connecting' : 'no Cancel button: the connect did not start'; break; }
          // Connected AND the IP check has decided what the session covers (never 'unchecked').
          ok = await until(`!!document.querySelector('[data-disconnect]') && /^(device|proxy-apps|proxy-only|leaking|split-include|split-exclude|split-exclude-unconfirmed)$/.test(document.querySelector('[data-coverage]')?.dataset.coverage ?? '')`, 150_000);
          detail = String(await js(`(document.querySelector('[data-coverage]')?.dataset.coverage ?? '') + ' | ' + (document.querySelector('main')?.textContent ?? '[no main layout: the setup screen is showing]').slice(0, 200)`));
          break;
        }
        case 'cancel-connect': {
          const at = arg.lastIndexOf(':');
          const re = at > 0 ? arg.slice(0, at) : arg; const secs = at > 0 ? Number(arg.slice(at + 1)) || 60 : 60;
          await nav('Connect');
          const seen = await until(`new RegExp(${JSON.stringify(re)}, 'i').test(document.querySelector('main')?.textContent ?? '') && !!document.querySelector('[data-cancel-connect]')`, secs * 1000);
          if (!seen) { detail = `never showed /${re}/ with a Cancel button`; break; }
          const phase = String(await js(`document.querySelector('main [aria-live]')?.textContent ?? ''`));
          await js(`document.querySelector('[data-cancel-connect]').click()`);
          ok = true; detail = `Cancel pressed during "${phase}"`; break;
        }
        case 'hold-port': {
          const n = Number(arg);
          const net = await import('node:net');
          const srv = net.createServer((c) => c.destroy());
          ok = await new Promise<boolean>((res) => { srv.once('error', (e) => { detail = e.message; res(false); }); srv.listen(n, '127.0.0.1', () => res(true)); });
          if (ok) { heldPorts.set(n, srv); detail = `holding 127.0.0.1:${n}`; }
          break;
        }
        case 'free-port': {
          const srv = heldPorts.get(Number(arg));
          if (srv) { await new Promise<void>((res) => srv.close(() => res())); heldPorts.delete(Number(arg)); }
          ok = true; detail = srv ? 'released' : 'was not held'; break;
        }
        case 'absent': {
          const t = String(await js(`(document.querySelector('main')?.textContent ?? '') + ' ' + [...document.querySelectorAll('[data-toast]')].map((e) => e.textContent).join(' ')`));
          const m = new RegExp(arg, 'i').exec(t);
          ok = !m; detail = m ? `shows "${m[0]}"` : 'not shown'; break;
        }
        case 'disconnect':
          await nav('Connect');
          await js(`document.querySelector('[data-disconnect]')?.click()`);
          ok = await until(`!document.querySelector('[data-disconnect]')`, 60_000);
          // The button goes at "Disconnecting…"; the user sees "Not connected" only when the daemon list
          // and direct internet confirm (W5d-b), so the oracle waits for that, not for the button.
          if (ok) ok = await until(`!/Disconnecting/.test(document.querySelector('main')?.textContent ?? '')`, 60_000);
          await wait(2000);
          break;
        case 'egress': { const ip = await curl(); ok = ip === want(arg); detail = `system ${ip}, want ${want(arg)}`; break; }
        case 'egress-socks': {
          await nav('Split tunnelling'); await wait(1200);
          const ep = String(await js(`((document.querySelector('main')?.textContent ?? '[no main layout: the setup screen is showing]').match(/socks5:\\/\\/(127\\.0\\.0\\.1:\\d+)/) ?? [])[1] ?? ''`));
          const ip = ep ? await curl(['--socks5-hostname', ep]) : 'no endpoint on screen';
          ok = ip === want(arg); detail = `socks ${ep} -> ${ip}`; break;
        }
        case 'egress-sysproxy': case 'egress-wininet': case 'egress-edge': { const ip = await sysproxyApp(); ok = ip === want(arg); detail = `system-proxy app ${ip}, want ${want(arg)}`; break; }
        case 'coverage': {
          await nav('Connect');
          ok = await until(`(document.querySelector('[data-coverage]')?.dataset.coverage ?? '') === ${JSON.stringify(arg)}`, 45_000);
          detail = String(await js(`(document.querySelector('[data-coverage]')?.dataset.coverage ?? 'none') + ' | ' + (document.querySelector('main')?.textContent ?? '[no main layout: the setup screen is showing]').slice(0, 240)`));
          break;
        }
        case 'proxy': {
          await nav('Split tunnelling'); await wait(1200);
          const box = `[...document.querySelectorAll('label')].find((l) => /through the VPN now/i.test(l.textContent))?.querySelector('input')`;
          const now = Boolean(await js(`!!(${box})?.checked`));
          if ((arg === 'on') !== now) await js(`(${box})?.click()`);
          await wait(2500);
          ok = Boolean(await js(`!!(${box})?.checked`)) === (arg === 'on'); detail = `checkbox ${ok ? 'now' : 'not'} ${arg}`; break;
        }
        case 'browser': {
          await nav('Split tunnelling'); await wait(1200);
          const clicked = await js(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Open browser through VPN/.test(x.textContent)); if (b) b.click(); return !!b; })()`);
          await wait(6000);
          const n = Number(await browserProcs());
          ok = !!clicked && n > 0; detail = `button ${clicked ? 'clicked' : 'missing'}, browser processes with our proxy flag: ${n}`; break;
        }
        case 'restore': {
          const clicked = await js(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Restore network'); if (b) b.click(); return !!b; })()`);
          if (!clicked) { await nav('Diagnostics'); await wait(1500); await js(`[...document.querySelectorAll('button')].find((x) => /Restore network/.test(x.textContent))?.click()`); }
          await wait(8000);
          const ip = await curl(); ok = ip === direct; detail = `${clicked ? 'banner' : 'diagnostics'} button, egress ${ip}`; break;
        }
        case 'nav': {
          await nav(arg); await wait(1200);
          ok = Boolean(await js(`[...document.querySelectorAll('nav[aria-label="Main"] button')].some((x) => x.textContent.trim() === ${JSON.stringify(arg)} && x.getAttribute('aria-current') === 'page')`)) || Boolean(await js(`document.querySelector('main h1')?.textContent.trim() === ${JSON.stringify(arg)}`));
          detail = String(await js(`document.querySelector('main') ? (document.querySelector('main h1')?.textContent ?? '') : 'no main layout: the setup screen is showing (' + (document.body.textContent ?? '').slice(0, 120) + ')'`)); break;
        }
        case 'click': {
          // CSS selector, or text:<visible button text>
          const sel = arg.startsWith('text:')
            ? `[...document.querySelectorAll('main button, main [role="button"]')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(arg.slice(5))}))`
            : `document.querySelector(${JSON.stringify(raw.slice(raw.indexOf('=') + 1))})`;
          ok = Boolean(await js(`(() => { const e = ${sel}; if (e) e.click(); return !!e; })()`));
          await wait(1200);
          detail = ok ? 'clicked' : 'not found'; break;
        }
        case 'count': {
          // count=<css selector>:<min>  at least <min> elements match
          const at = raw.lastIndexOf(':');
          const sel = raw.slice(raw.indexOf('=') + 1, at);
          // Waits up to 20 s: lists that load in the background (apps, servers) count once shown.
          const min = Number(raw.slice(at + 1));
          ok = await until(`document.querySelectorAll(${JSON.stringify(sel)}).length >= ${min}`, 20_000);
          const n = Number(await js(`document.querySelectorAll(${JSON.stringify(sel)}).length`));
          detail = `${n} match ${sel}`; break;
        }
        case 'check': {
          // check=<css selector of a checkbox>:on|off  (sets it through a click, like a person)
          const at = raw.lastIndexOf(':');
          const sel = JSON.stringify(raw.slice(raw.indexOf('=') + 1, at));
          const want = raw.slice(at + 1) === 'on';
          const now = await js(`document.querySelector(${sel})?.checked`);
          if (now === undefined || now === null) { detail = 'not found'; break; }
          if (Boolean(now) !== want) await js(`document.querySelector(${sel}).click()`);
          await wait(1500);
          ok = Boolean(await js(`document.querySelector(${sel})?.checked`)) === want; detail = `now ${want ? 'on' : 'off'}`; break;
        }
        case 'split-mode': {
          await nav('Split tunnelling'); await wait(1200);
          await js(`document.querySelector('[data-split-mode="${arg}"] input')?.click()`);
          await wait(800);
          ok = Boolean(await js(`document.querySelector('[data-split-mode="${arg}"] input')?.checked`)); detail = `mode ${arg}`; break;
        }
        case 'split-app': {
          // split-app=<visible app name>:on|off  ticks the app's row in the list (waits for the list)
          const at = arg.lastIndexOf(':');
          const name = arg.slice(0, at);
          const want = arg.slice(at + 1) === 'on';
          if (!(await js(`!!document.querySelector('[data-app-list]')`))) { await nav('Split tunnelling'); await wait(1200); }
          const row = `[...document.querySelectorAll('[data-app]')].find((l) => l.querySelector('span span')?.textContent.trim() === ${JSON.stringify(name)})`;
          if (!(await until(`!!(${row})`, 40_000))) { detail = `no app row named ${name}`; break; }
          if (Boolean(await js(`(${row}).querySelector('input').checked`)) !== want) await js(`(${row}).querySelector('input').click()`);
          await wait(600);
          ok = Boolean(await js(`(${row}).querySelector('input').checked`)) === want;
          detail = String(await js(`(${row}).dataset.app`)); break;
        }
        case 'phrase-check': {
          // phrase-check=right|wrong (Q0297): on the new-wallet phrase card, read the words off the
          // screen, press "I saved it", type the asked words (wrong = the first one replaced) and press
          // Check. right: the check closes; wrong: it stays open and names the word. The words never
          // leave the window (not in detail, not in a log).
          const back = '[data-phrase-check] button.btn-ghost';
          if (await js(`!!document.querySelector('[data-phrase-check]')`)) { await js(`document.querySelector(${JSON.stringify(back)})?.click()`); await wait(600); }
          const words = (await js(`[...document.querySelectorAll('[data-phrase-word]')].map((e) => e.textContent.replace(/^\\s*\\d+\\.\\s*/, '').trim())`)) as string[] | null;
          if (!words?.length) { ok = false; detail = 'no phrase on screen'; break; }
          await js(`document.querySelector('[data-phrase-saved]')?.click()`);
          if (!(await until(`!!document.querySelector('[data-phrase-ask]')`, 10_000))) { ok = false; detail = 'the word check did not open'; break; }
          const asks = ((await js(`[...document.querySelectorAll('[data-phrase-ask]')].map((e) => Number(e.dataset.phraseAsk))`)) as number[] | null) ?? [];
          for (let k = 0; k < asks.length; k++) {
            const right = words[asks[k] - 1] ?? '';
            const text = arg === 'wrong' && k === 0 ? (right === 'abandon' ? 'zoo' : 'abandon') : right;
            await js(`(() => { const i = document.querySelector('[data-phrase-ask="${asks[k]}"]'); if (!i) return; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(text)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
          }
          await wait(300);
          await js(`document.querySelector('[data-phrase-check-submit]')?.click()`);
          if (arg === 'wrong') {
            ok = await until(`!!document.querySelector('[data-phrase-wrong]') && !!document.querySelector('[data-phrase-check]')`, 5000);
            detail = ok ? `wrong word refused (word ${String(await js(`document.querySelector('[data-phrase-wrong]').dataset.phraseWrong`))} of ${asks.length} asked)` : 'a wrong word was accepted';
          } else {
            ok = await until(`!document.querySelector('[data-phrase-check]') && !document.querySelector('[data-phrase-saved]')`, 10_000);
            detail = ok ? `${asks.length} asked words accepted` : 'the right words were refused';
          }
          break;
        }
        case 'fill': {
          // fill=<aria-label>:<text>  types <text> into the input with that aria-label (first ':' splits).
          // React owns the value: set it through the native setter, then fire 'input'.
          const at = arg.indexOf(':');
          const label = arg.slice(0, at);
          const text = arg.slice(at + 1);
          // An input or a textarea (onboarding import box): each has its own native value setter.
          const q = `document.querySelector(${JSON.stringify(`input[aria-label="${label}"], textarea[aria-label="${label}"]`)})`;
          ok = Boolean(await js(`(() => { const i = ${q}; if (!i) return false; const P = i instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement; Object.getOwnPropertyDescriptor(P.prototype, 'value').set.call(i, ${JSON.stringify(text)}); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`));
          await wait(400);
          const now = String(await js(`${q}?.value ?? ''`));
          ok = ok && now === text;
          detail = ok ? `${label} = ${text.slice(0, 12)}…` : `input "${label}" ${now ? `holds ${now.slice(0, 12)}…` : 'not found'}`; break;
        }
        case 'split-route': {
          // split-route=<address or range>:on|off  types it into "Address or range" and presses Add,
          // or presses its × to remove it. The last ':' splits, so IPv6 ranges work.
          const at = arg.lastIndexOf(':');
          const r = arg.slice(0, at);
          const want = arg.slice(at + 1) === 'on';
          if (!(await js(`!!document.querySelector('input[aria-label="Address or range"]')`))) { await nav('Split tunnelling'); await wait(1200); }
          const has = `[...document.querySelectorAll('[data-route-list] li')].some((l) => l.firstChild?.textContent.trim() === ${JSON.stringify(r)})`;
          if (want && !(await js(has))) {
            // React owns the input's value: set it through the native setter, then fire 'input'.
            await js(`(() => { const i = document.querySelector('input[aria-label="Address or range"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(r)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
            await wait(300);
            await js(`document.querySelector('input[aria-label="Address or range"]').form.requestSubmit()`);
          }
          if (!want) await js(`document.querySelector('[aria-label=${JSON.stringify(`Remove ${r}`)}]')?.click()`);
          ok = await until(want ? has : `!(${has})`, 5_000);
          detail = ok ? `${r} ${want ? 'listed' : 'removed'}` : String(await js(`document.querySelector('[role=alert]')?.textContent ?? 'not listed'`)); break;
        }
        case 'split-apply': {
          // Presses Apply on the Split tunnelling page and waits until the service took it (bar gone).
          await nav('Split tunnelling'); await wait(1200);
          const clicked = await js(`(() => { const b = document.querySelector('[data-split-apply] .btn-primary'); if (b && !b.disabled) { b.click(); return true; } return false; })()`);
          if (!clicked) { detail = String(await js(`document.querySelector('[data-split-apply]')?.textContent ?? 'no apply bar (nothing changed)'`)); break; }
          ok = await until(`!document.querySelector('[data-split-apply]')`, 120_000);
          detail = ok ? 'applied' : String(await js(`document.querySelector('[data-split-apply]')?.textContent ?? ''`)); break;
        }
        case 'ks-mode': {
          // ks-mode=off|on|persist: the Kill switch page radio, then Apply. The page has one "On"
          // (data-ks-mode="persist"), so on and persist pick the same radio.
          await nav('Kill switch'); await wait(1500);
          const ksId = arg === 'on' ? 'persist' : arg;
          await js(`document.querySelector('[data-ks-mode="${ksId}"] input')?.click()`);
          await wait(800);
          const clicked = await js(`(() => { const b = document.querySelector('[data-ks-apply] .btn-primary'); if (b && !b.disabled) { b.click(); return true; } return false; })()`);
          if (!clicked) {
            ok = Boolean(await js(`document.querySelector('[data-ks-mode="${ksId}"] input')?.checked`)) && !(await js(`!!document.querySelector('[data-ks-apply]')`));
            detail = ok ? `already ${arg}` : 'no Apply bar'; break;
          }
          ok = await until(`!document.querySelector('[data-ks-apply]')`, 120_000);
          detail = ok ? `applied ${arg}` : String(await js(`document.querySelector('[data-ks-apply]')?.textContent ?? ''`)); break;
        }
        case 'ks-state': {
          // ks-state=blocking|armed|standby|off[:<secs>]: what the Kill switch page says now (waits up
          // to 60 s, or <secs>; the detail says how long it took: Q0304 wants blocking within 15 s).
          const [want, secs] = arg.split(':');
          const t0 = Date.now();
          await nav('Kill switch'); await wait(800);
          ok = await until(`document.querySelector('[data-ks-state]')?.dataset.ksState === ${JSON.stringify(want)}`, (Number(secs) || 60) * 1000);
          detail = `${String(await js(`(document.querySelector('[data-ks-state]')?.dataset.ksState ?? 'none') + ' | ' + (document.querySelector('[data-ks-state]')?.textContent ?? '').slice(0, 160)`))} | ${((Date.now() - t0) / 1000).toFixed(1)} s`; break;
        }
        case 'kill-proc': {
          // kill-proc=<process name>: the protocol process dies mid-session (VM only: needs the
          // elevated S4U task; dvpnd runs it as SYSTEM).
          // Then sample the system exit 8 times over ~30 s: it may be blocked ('') or back on the node
          // after dvpnd reconnects, but never the user's own IP (that would be a leak).
          // kill-proc=<name>:noleakcheck = kill switch OFF on purpose (an ended-session state): only the kill counts.
          // Linux: dvpnd runs the protocol process as root; the VM user has passwordless sudo (VM only).
          const [procName, mode] = arg.split(':');
          const linux = process.platform === 'linux';
          const had = linux ? await run('pgrep', ['-x', procName]) : '';
          const outText = linux
            ? (await run('sudo', ['-n', 'pkill', '-KILL', '-x', procName], 15_000), had ? `SUCCESS killed ${procName} (pid ${had.split(/\s+/).join(' ')})` : `no ${procName} process`)
            : await run('taskkill.exe', ['/F', '/IM', `${procName}.exe`], 15_000);
          if (mode === 'noleakcheck') { ok = /SUCCESS/i.test(outText); detail = outText.slice(0, 120) || 'nothing was killed'; break; }
          const samples: string[] = [];
          for (let k = 0; k < 8; k++) { samples.push((await curl()) || 'none'); await wait(2500); }
          const leaked = samples.filter((x) => x === direct).length;
          ok = /SUCCESS/i.test(outText) && leaked === 0;
          detail = `${outText.slice(0, 80) || 'taskkill printed nothing'} | samples ${samples.join(',')} | ${leaked} leaked`; break;
        }
        case 'expect': { const t = String(await js(`(document.querySelector('main')?.textContent ?? '[no main layout: the setup screen is showing]')`)); ok = new RegExp(arg, 'i').test(t); detail = t.slice(0, 160); break; }
        case 'shot': await shot(`s-${arg}`); ok = true; break;
        case 'cli': {
          // The app's own CLI as a separate process while the window stays open (a session
          // started elsewhere). Args are space-separated; exit 0 = ok.
          const full = raw.slice(raw.indexOf('=') + 1);
          const r = await runCli(full.split(' ').filter(Boolean));
          ok = r.code === 0; detail = `exit ${r.code} | ${r.out.split('\n').filter((l) => !l.startsWith('[rpc]')).slice(-4).join(' / ').slice(0, 300)}`; break;
        }
        case 'wait-text': {
          // wait-text=<regex>:<seconds>  the screen (main) shows it within that time
          const full = raw.slice(raw.indexOf('=') + 1);
          const at = full.lastIndexOf(':');
          const re = full.slice(0, at); const secs = Number(full.slice(at + 1)) || 15;
          ok = await until(`new RegExp(${JSON.stringify(re)}, 'i').test(document.querySelector('main')?.textContent ?? '')`, secs * 1000);
          detail = String(await js(`(document.querySelector('main')?.textContent ?? '[no main layout]').slice(0, 200)`)); break;
        }
        case 'sleep': { await wait((Number(arg) || 1) * 1000); ok = true; detail = `${arg} s`; break; }
        case 'gone': {
          // gone=<css selector>:<seconds>  nothing matches within that time
          const at = raw.lastIndexOf(':');
          const sel = raw.slice(raw.indexOf('=') + 1, at);
          ok = await until(`document.querySelectorAll(${JSON.stringify(sel)}).length === 0`, (Number(raw.slice(at + 1)) || 20) * 1000);
          detail = `${Number(await js(`document.querySelectorAll(${JSON.stringify(sel)}).length`))} match ${sel}`; break;
        }
        case 'signal': {
          // Hand-off to the VM harness (admin) for what the app cannot do itself, e.g. stop the service.
          fs.mkdirSync(SIG_DIR, { recursive: true });
          fs.writeFileSync(path.join(SIG_DIR, arg), String(Date.now()));
          ok = true; detail = `signalled ${arg}`; break;
        }
        case 'await': {
          // await=<name>:<seconds>  the harness wrote <name>.ack
          const [sig, secs = '120'] = arg.split(':');
          const f = path.join(SIG_DIR, `${sig}.ack`);
          for (let t = 0; t < Number(secs) * 2 && !fs.existsSync(f); t++) await wait(500);
          ok = fs.existsSync(f); detail = ok ? fs.readFileSync(f, 'utf8').trim().slice(0, 200) : `no ${sig}.ack after ${secs} s`; break;
        }
        default: detail = `unknown step "${name}"`;
      }
    } catch (err) {
      detail = `step crashed: ${(err as Error).message}`;
    }
    const v = await visible().catch(() => []);
    await shot(`s${String(i).padStart(2, '0')}-${name}`).catch(() => undefined);
    out.push({ step: raw, ok, detail, visible: v });
    fs.writeFileSync(path.join(dir, 'scenario.json'), JSON.stringify(out, null, 2));
  }
  return out;
}
