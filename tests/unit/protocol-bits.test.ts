// ─── Protocol bits in a node's service mask: the cb33 table (sentinel-go-sdk <protocol>.go protocolBit) ───
import { describe, expect, it } from 'vitest';
import { PROTOCOL_BITS, protocolNames } from '../../src/core/chain/idl';

describe('protocol bits (cb33)', () => {
  it('match cb33: wireguard 1, v2ray 2, openvpn 4, amneziawg 8, xray 16, hysteria2 32', () => {
    expect(Object.fromEntries(PROTOCOL_BITS.map(([b, n]) => [n, b]))).toEqual({ wireguard: 1, v2ray: 2, openvpn: 4, amneziawg: 8, xray: 16, hysteria2: 32 });
  });
  it('decode a mask (not the pre-cb33 table: 4 was xray, 32 was amneziawg)', () => {
    expect(protocolNames(4)).toEqual(['openvpn']);
    expect(protocolNames(32)).toEqual(['hysteria2']);
    expect(protocolNames(1 | 16)).toEqual(['wireguard', 'xray']);
    expect(protocolNames(63)).toHaveLength(6);
  });
});
