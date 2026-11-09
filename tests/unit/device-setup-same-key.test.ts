// TLX 0.1.16 (u22): the wallet was loaded from the service's own key file, so wallet == device. The program
// refuses a grant to its granter (grant.rs require_keys_neq → ParamOutOfRange 6003), which read as a range
// error on the allowance. Now the plan refuses first, names it, and signs nothing (no chain read either).
import { describe, expect, it } from 'vitest';
import { planDeviceSetup, sameKeyMessage } from '../../src/core/app/device-setup';

const KEY = 'Du8x8Sj3XYBBKQ1AuRGHUXGckdpoqiKQkCngWX2PKvoZ';
const OTHER = 'Hen2LVP6KooGaXEvdSyCHWghsEY4gLLn7wix8z6zHFSa';
const status = { delegated: '0', grant: null, deviceLamports: 0 } as never;

describe('device setup when the wallet is the device key', () => {
  it('refuses before reading the chain or building a transaction, and says what to use', async () => {
    await expect(planDeviceSetup(KEY, KEY, '2000000')).rejects.toThrow(sameKeyMessage(KEY));
    expect(sameKeyMessage(KEY)).toContain(KEY);
    expect(sameKeyMessage(KEY)).toContain('Use your own wallet');
    expect(sameKeyMessage(KEY)).toContain('Nothing was signed.');
  });
  it('negative control: a different wallet still gets its plan', async () => {
    const p = await planDeviceSetup(OTHER, KEY, '2000000', status);
    expect(p.steps.length).toBeGreaterThan(0);
  });
});
