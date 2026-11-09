import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readToml } from '../../src/core/daemon/config';
import { DNS_PRESETS } from '../../src/core/daemon/dns-presets';

// Q0365 (u24b lab 10-30): Settings showed the Handshake list upgraded (Q0267, + 1.1.1.1) but dvpnd's
// own file kept the old pair, so the session's DNS forwarder raced two lossy servers with no
// fallback. The package upgrade (migrate-daemon-config.sh) now upgrades the file itself.

const SCRIPT = path.resolve('resources/scripts/upgrade-dns-list.sh');
const client = (servers: string): string => `basis = 'per_gb'\n\n[network]\ndns_backend = 'resolvectl'\ndns_servers = ${servers}\nkill_switch = 'on'\n`;

function run(text: string): { out: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnsup-'));
  const f = path.join(dir, 'config.toml');
  fs.writeFileSync(f, text);
  fs.chmodSync(f, 0o640);
  const out = execFileSync('bash', [SCRIPT, f], { encoding: 'utf8' }).trim();
  return { out, file: fs.readFileSync(f, 'utf8') };
}

describe.skipIf(process.platform === 'win32')('Handshake DNS list upgrade in the dvpnd file', () => {
  it('the old 2-server default becomes the current preset; nothing else in the file changes', () => {
    for (const old of ["['103.196.38.38', '103.196.38.39']", '["103.196.38.38","103.196.38.39"]', "[ '103.196.38.38' , '103.196.38.39', ]"]) {
      const r = run(client(old));
      expect(r.out, old).toBe('upgraded');
      expect(readToml(r.file, 'network', 'dns_servers')).toEqual(DNS_PRESETS.handshake.servers);
      expect(readToml(r.file, 'network', 'kill_switch')).toBe('on');
      expect(readToml(r.file, 'network', 'dns_backend')).toBe('resolvectl');
      expect(r.file.replace(/dns_servers = .*/, '')).toBe(client(old).replace(/dns_servers = .*/, ''));
    }
  });

  it('a current, custom or picked list is left alone', () => {
    for (const keep of [
      "['103.196.38.38', '103.196.38.39', '1.1.1.1']",
      "['9.9.9.9']",
      "['1.1.1.1', '1.0.0.1']",
      "['103.196.38.39', '103.196.38.38']",
      "['103.196.38.38']",
      "['103.196.38.38', '103.196.38.39', '8.8.8.8']",
    ]) {
      const r = run(client(keep));
      expect(r.out, keep).toBe('');
      expect(r.file).toBe(client(keep));
    }
  });

  it('keeps the file mode, and a missing file is not an error', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnsup-'));
    const f = path.join(dir, 'config.toml');
    fs.writeFileSync(f, client("['103.196.38.38', '103.196.38.39']"));
    fs.chmodSync(f, 0o640);
    execFileSync('bash', [SCRIPT, f]);
    expect(fs.statSync(f).mode & 0o777).toBe(0o640);
    expect(execFileSync('bash', [SCRIPT, path.join(dir, 'none.toml')], { encoding: 'utf8' })).toBe('');
  });

  it('runs from the package upgrade and setup migration, before the restart', () => {
    const m = fs.readFileSync('resources/scripts/migrate-daemon-config.sh', 'utf8');
    // the client file: client/config.toml in a pre-cb33 home, the one config.toml in c0
    expect(m).toContain('upgrade-dns-list.sh" "$HOME_DIR/$CLIENT_REL"');
    expect(m).toContain('[ -f "$HOME_DIR/$CLIENT_REL" ] || CLIENT_REL=config.toml');
  });
});
