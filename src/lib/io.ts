import type { Scenario } from '../data/samples';

export interface Saved {
  app: 'income-approach-valuation';
  version: 1;
  scenario: Scenario;
}

export function toJson(s: Scenario): string {
  const saved: Saved = { app: 'income-approach-valuation', version: 1, scenario: s };
  return JSON.stringify(saved, null, 2);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isArr = (v: unknown): v is unknown[] => Array.isArray(v);

/** Parse and validate a saved scenario. Returns an error string when the file is not usable. */
export function fromJson(text: string): { scenario?: Scenario; error?: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: 'Not valid JSON.' };
  }
  const s = (raw as { scenario?: Record<string, unknown>; app?: string })?.scenario;
  if (!s || (raw as { app?: string }).app !== 'income-approach-valuation') return { error: 'Not a saved scenario from this app.' };
  const needNums = ['vacancyPct', 'creditLossPct', 'otherIncome', 'selectedCap', 'selectedGrm', 'leaseUpMonths'];
  for (const k of needNums) if (!isNum(s[k])) return { error: `Field "${k}" must be a number.` };
  for (const k of ['units', 'expenses', 'comps', 'adjustments']) if (!isArr(s[k])) return { error: `Field "${k}" must be a list.` };
  if (typeof s.name !== 'string') return { error: 'Missing name.' };
  for (const k of ['band', 'dcf', 'weights']) if (typeof s[k] !== 'object' || s[k] === null) return { error: `Field "${k}" is missing.` };
  return { scenario: s as unknown as Scenario };
}

const q = (v: string | number): string => {
  const t = String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** Two-column CSV summary: section, item, value. Numbers are raw, not formatted. */
export function summaryCsv(rows: [string, string, number | string][]): string {
  return ['section,item,value', ...rows.map(([a, b, c]) => [a, b, c].map(q).join(','))].join('\n') + '\n';
}
