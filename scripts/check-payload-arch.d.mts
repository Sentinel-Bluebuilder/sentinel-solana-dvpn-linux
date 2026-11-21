export type BinaryKind = { kind: "elf"; machine: number } | { kind: "pe" } | { kind: "macho" };
export function binaryKind(head: Buffer): BinaryKind | null;
export function foreignBinaries(root: string, arch: string): { path: string; why: string }[];
