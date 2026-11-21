export interface LogicalEdit { start: number; end: number; raw: string; fixed: string; line: number }
export function convert(source: string, fileName?: string): { out: string; edits: LogicalEdit[]; kept: Array<{ line: number; text: string }> };
