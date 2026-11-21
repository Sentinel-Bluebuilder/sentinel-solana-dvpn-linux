// ─── rc9-e H: no kill switch turned on from a remote session without saying so (review live, review evidence) ───
// `daemon set --kill-switch on` writes dvpnd `persist` (core/daemon/config.ts writtenKillSwitch). After any lost
// session (a dvpnd crash or stop) dvpnd re-applies its block at EVERY boot: Linux `inet sentinel-dvpn-c0` (input +
// output policy drop), Windows persistent WFP filters on ALE_AUTH_CONNECT + RECV_ACCEPT. New inbound SSH and the cloud
// guest agent are dropped, so a server reached over SSH (or RDP) becomes unreachable, and a reboot does not help.
// So a CLI run from a remote session refuses to turn it on unless --allow-remote-lockout is given.
import { CLI_NAME } from './cli-fail';
import { remoteAncestry } from '../shared/remote-ancestry';

export type RemoteKind = 'ssh' | 'rdp';

/** How this process is reached: SSH (OpenSSH and Win32-OpenSSH set SSH_CONNECTION / SSH_CLIENT / SSH_TTY), or a
 *  Windows Remote Desktop session (SESSIONNAME "RDP-Tcp#…"). null = a local console session. */
export function remoteSession(env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): RemoteKind | null {
  if (env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY) return 'ssh';
  if (platform === 'win32' && /^RDP-/i.test(env.SESSIONNAME ?? '')) return 'rdp';
  return null;
}

export const KS_REMOTE_FLAG = 'allow-remote-lockout';
export const KS_RESTORE = `${CLI_NAME} daemon restore-network`;

/** The sentence both the refusal and the status warning use. */
export function lockoutRisk(kind: RemoteKind): string {
  const via = kind === 'ssh' ? 'SSH' : 'Remote Desktop';
  const blocks = `If the VPN connection is lost, the kill switch blocks every new connection to this computer, ${via} included.`;
  const holds = `It keeps blocking after a reboot until \`${KS_RESTORE}\` is run locally or from the provider's console.`;
  return `${blocks} ${holds}`;
}

/** The refusal: code kill-switch-remote (exit 5, money none). next connects without the kill switch; alsoNext is the
 *  same setting with the override, for someone who has console access. */
export function killSwitchRemoteRefusal(kind: RemoteKind, mode: string): Error & { code: string; action: string; alsoNext: string } {
  const via = kind === 'ssh' ? 'an SSH session' : 'a Remote Desktop session';
  return Object.assign(new Error(`The kill switch was not turned on: this command runs in ${via}. ${lockoutRisk(kind)} Nothing was changed.`), {
    code: 'kill-switch-remote',
    action: `${CLI_NAME} agent up --yes`,
    alsoNext: `${CLI_NAME} daemon set --kill-switch ${mode} --${KS_REMOTE_FLAG} --yes (only with console access to this computer)`,
  });
}

/** rc.10 KS-SUDO: the SSH_* / SESSIONNAME variables, then the login and the parent chain (they survive sudo and su). */
export function remoteKind(env: NodeJS.ProcessEnv, platform: string, ancestry: (platform: string) => RemoteKind | null = remoteAncestry): RemoteKind | null {
  return remoteSession(env, platform) ?? ancestry(platform);
}

/** daemon set: the refusal for this request, or null (off, no kill-switch flag, the override, or a local session). */
export function ksRemoteCheck(mode: string | undefined, override: boolean, env: NodeJS.ProcessEnv = process.env, platform: string = process.platform,
  ancestry: (platform: string) => RemoteKind | null = remoteAncestry): Error | null {
  if ((mode !== 'on' && mode !== 'persist') || override) return null; // off, absent, or a bad value (a usage error later)
  const kind = remoteKind(env, platform, ancestry);
  return kind ? killSwitchRemoteRefusal(kind, mode) : null;
}

/** agent status: the warning fields when the kill switch is on and this is a remote session; {} otherwise. */
export function ksRemoteRiskFields(killSwitch: string | undefined, env: NodeJS.ProcessEnv = process.env, platform: string = process.platform,
  ancestry: (platform: string) => RemoteKind | null = remoteAncestry): { killSwitchRemoteRisk?: true; killSwitchRemoteNote?: string; restoreNetwork?: string } {
  if (killSwitch !== 'on' && killSwitch !== 'persist') return {};
  const kind = remoteKind(env, platform, ancestry);
  return kind ? { killSwitchRemoteRisk: true, killSwitchRemoteNote: lockoutRisk(kind), restoreNetwork: KS_RESTORE } : {};
}
