export function elfLength(buf: Buffer): number;
export function payloadAt(buf: Buffer, off: number): boolean;
export function swapRuntime(appimage: string, pin: { url: string; sha256: string; version?: string }, cacheDir: string): Promise<number>;
