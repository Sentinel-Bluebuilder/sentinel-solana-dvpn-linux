// ─── Types for scripts/i18n-terms.mjs ───
export interface Term { id: string; kind?: 'term' | 'phrase' | 'name'; en: string[]; word: string; forms?: string[]; status: 'confirmed' | 'unconfirmed'; examples?: number; except?: string[]; rejected?: Array<{ word: string; why: string }> }
export interface Sheet { language: string; reviewed?: boolean; rules?: Record<string, unknown>; terms: Term[] }
export interface Miss { term: string; key: string; english: string; translation: string }
export const TERMS_DIR: string;
export function englishOf(key: string): string;
export function readSheet(code: string): Sheet | null;
export function checkLanguage(code: string, sheet?: Sheet | null, english?: Record<string, unknown>, own?: Record<string, unknown>): { code: string; missingSheet: boolean; misses: Miss[]; unconfirmed: string[]; checked: number };
