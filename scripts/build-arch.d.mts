export type BuildArch = 'x64' | 'arm64';
export interface LockBuild { sha256: string; url?: string; file?: string }
export const ARCHES: BuildArch[];
export const ELF_MACHINE: Record<BuildArch, number>;
export function targetArch(argv: string[], hostArch: string): BuildArch;
export function elfArch(buf: Uint8Array): BuildArch | null;
export function pickBuild(entry: { name: string; builds?: Partial<Record<string, LockBuild>> }, arch: string): LockBuild;
