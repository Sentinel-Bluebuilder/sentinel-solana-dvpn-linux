// ─── CODE-AUDIT U-20: a number inside an address or port never picks the error message ───
import { describe, it, expect } from 'vitest';
import { connectErrorCopy } from '../../src/core/session/state';

describe('connectErrorCopy (U-20)', () => {
  it('an IP or port with 102, 6024 or 429 in it is not read as that error', () => {
    const t = 'StartSession: fetching node metadata: dial tcp 203.0.113.102:6024: connection refused';
    expect(connectErrorCopy(t).code).toBe('node-offline');
    expect(connectErrorCopy('dial tcp 198.51.100.7:4290: i/o reset').code).not.toBe('rpc-busy');
  });
  it('positive controls: the real errors still map', () => {
    expect(connectErrorCopy('Program log: AnchorError occurred. Error Number: 102. Error Message: InstructionDidNotDeserialize').code).toBe('chain-encoding');
    expect(connectErrorCopy('failed: custom program error: 0x1788').code).toBe('spending-limit');
    expect(connectErrorCopy('429 Too Many Requests').code).toBe('rpc-busy');
  });
  it("Windows' wording for a refused port counts as the server being down", () => {
    expect(connectErrorCopy('fetching node metadata: dial tcp 203.0.113.5:443: connectex: No connection could be made because the target machine actively refused it.').code).toBe('node-offline');
  });
});
