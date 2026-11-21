// ─── W31-16 (rc9-c2, review): `proxy browser --url` takes only a web address ───
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { webUrl, WEB_URL_ONLY } from '../../src/shared/web-url';
import { browserArgs } from '../../src/main/system/browser';
import { EXIT } from '../../src/cli/exit-codes';
import { UsageError, parseArgs, str } from '../../src/cli/args';

describe('W31-16: webUrl', () => {
  it('flags, file:, javascript:, data: and non-URLs are refused', () => {
    for (const v of ['--proxy-server=direct://', '--renderer-cmd-prefix=calc.exe', ' --proxy-server=direct://', '-x', 'javascript:alert(1)', 'file:///C:/Windows/win.ini', 'data:text/html,x', 'ftp://x', 'not a url', '', 'http://']) {
      expect(webUrl(v), v).toBeNull();
    }
  });
  it('an http(s) URL passes as its href', () => {
    expect(webUrl('https://x')).toBe('https://x/');
    expect(webUrl('http://example.com/a?b=1')).toBe('http://example.com/a?b=1');
  });
});

describe('W31-16: browserArgs', () => {
  it('the page comes last, after the end-of-switches marker', () => {
    const a = browserArgs('127.0.0.1:1080', 'p', 'https://api.ipify.org');
    expect(a.slice(-2)).toEqual(['--', 'https://api.ipify.org/']);
    expect(a.filter((x) => x.startsWith('--proxy-server='))).toEqual(['--proxy-server=socks5://127.0.0.1:1080']);
  });
  it('a flag as the page is refused, never passed on', () => {
    expect(() => browserArgs('127.0.0.1:1080', 'p', '--proxy-server=direct://')).toThrow(/not an http\(s\) web address/);
    expect(() => browserArgs('127.0.0.1:1080', 'p', '--renderer-cmd-prefix=x')).toThrow();
  });
});

describe('W31-16: the CLI refuses before anything starts', () => {
  it('info-cmd checks --url with webUrl before adoptRunningSession and passes only the href', () => {
    const s = fs.readFileSync(path.resolve('src/cli/info-cmd.ts'), 'utf8');
    const at = s.indexOf('if (rawUrl !== undefined && !page) throw new UsageError(WEB_URL_ONLY);');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(s.indexOf('await adoptRunningSession();', s.indexOf("sub === 'browser'")));
    expect(s).toMatch(/launchBrowser\(sep, b as BrowserName \| undefined, page\)/);
    expect(s).not.toMatch(/str\(a, 'url'\) \?\? undefined/);
  });
  it('review w11 live repro: the one-word --url=--proxy-server=direct:// reaches str() whole, and is refused', () => {
    for (const v of ['--url=--proxy-server=direct://', '--url=--renderer-cmd-prefix=calc.exe', '--url=javascript:alert(1)', '--url=file:///C:/x']) {
      const raw = str(parseArgs(['proxy', 'browser', v]), 'url');
      expect(raw, v).toBe(v.slice('--url='.length));
      expect(webUrl(raw!), v).toBeNull();
    }
    expect(webUrl(str(parseArgs(['proxy', 'browser', '--url=https://x']), 'url')!)).toBe('https://x/');
  });
  it('a usage error: exit 3 (index.ts), and the code path is a UsageError', () => {
    expect(EXIT.usage).toBe(3);
    expect(fs.readFileSync(path.resolve('src/cli/index.ts'), 'utf8')).toMatch(/if \(err instanceof UsageError\) \{ writeUsage\([^;]*\); return 3; \}/);
    expect(new UsageError(WEB_URL_ONLY)).toBeInstanceOf(UsageError);
  });
});
