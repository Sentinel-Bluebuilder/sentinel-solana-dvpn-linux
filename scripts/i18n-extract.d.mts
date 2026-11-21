// ─── Types for scripts/i18n-extract.mjs (imported by the i18n gate tests) ───
export type Entry = string | Record<string, string>;
export type Catalog = Record<string, Entry>;
export interface KeyHit { key: string; value: Entry; context?: string; line: number }
export interface Candidate { line: number; kind: string; text: string }
export interface Physical { line: number; token: string }
export interface FileScan { file: string; keys: KeyHit[]; errors: Array<{ line: number; why: string }>; candidates: Candidate[]; physical: Physical[] }
export interface CensusRow { files: number; filesWithText: number; sentences: number; unique: number; wrapped: number; physical: number; byKind: Record<string, number> }
export interface Sentence { text: string; at: string[]; folders: string[]; wrapped: boolean; safety: string[] }
export const SAFETY: Record<string, RegExp>;
export function safetyTags(text: string, line?: string, context?: string): string[];

export const ROOT: string;
export const LOCALES: string;
export const CHUNKS: readonly string[];
export const SHOWN_ERROR_CLASSES: readonly string[];
export function chunkPath(code: string, chunk: string): string;
export function chunkOf(relPath: string): string;
export function rel(file: string): string;
export function folderOf(relPath: string): string;
export function sourceFiles(): string[];
export function scanFile(file: string): FileScan;
export function scanSource(sf: unknown, text?: string): FileScan & { compared: Candidate[] };
export function isPhysicalClass(token: string): boolean;
export function extract(files?: string[]): { catalog: Catalog; chunks: Record<string, Catalog>; errors: string[] };
export function serialise(catalog: Record<string, unknown>): string;
export function readLanguage(code: string): Catalog;
export function languageDirs(): string[];
export function syncLanguage(code: string, chunks?: Record<string, Catalog>): string[];
export function allSentences(files?: string[]): { sentences: Sentence[]; words: Array<[string, number]> };
export function census(files?: string[]): { rows: Record<string, CensusRow>; short: string[] };
export function unwrapped(files: string[]): Array<Candidate & { file: string }>;
