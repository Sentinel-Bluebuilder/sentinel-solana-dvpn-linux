export function binaryModules(buf: Uint8Array | string): Map<string, string>;
export function noticeModules(text: string): Map<string, string>;
export function moduleDiff(binary: Map<string, string>, notices: Map<string, string>): string[];
