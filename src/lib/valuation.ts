import { irr, npv } from './finance';
import { parseCsv, toNumber } from './csv';

/* ---------- Rent roll ---------- */

export interface Unit {
  id: string;
  type: string;
  sf: number;
  /** In-place monthly rent. 0 when vacant. */
  rent: number;
  /** Market monthly rent from rent comparables. */
  marketRent: number;
  occupied: boolean;
}

export interface RentRollSummary {
  units: number;
  sf: number;
  occupiedUnits: number;
  physicalOccupancy: number;
  /** Annual rent: in-place for occupied units, market for vacant units. */
  scheduledAnnual: number;
  /** Annual rent if every unit rented at market. */
  marketAnnual: number;
  /** Market minus scheduled, annual. Positive means in-place rents are below market. */
  mtm: number;
}

export function summarizeRentRoll(units: Unit[]): RentRollSummary {
  const sf = units.reduce((s, u) => s + u.sf, 0);
  const occupiedUnits = units.filter((u) => u.occupied).length;
  const scheduledAnnual = units.reduce((s, u) => s + (u.occupied ? u.rent : u.marketRent) * 12, 0);
  const marketAnnual = units.reduce((s, u) => s + u.marketRent * 12, 0);
  return {
    units: units.length,
    sf,
    occupiedUnits,
    physicalOccupancy: units.length ? occupiedUnits / units.length : 0,
    scheduledAnnual,
    marketAnnual,
    mtm: marketAnnual - scheduledAnnual,
  };
}

export type RentBasis = 'market' | 'contract';

export function parseRentRollCsv(text: string): { units: Unit[]; errors: string[] } {
  const rows = parseCsv(text);
  const errors: string[] = [];
  const header = rows[0]?.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_')) ?? [];
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const iId = col('unit', 'id', 'unit_id');
  const iType = col('type', 'unit_type');
  const iSf = col('sf', 'sqft', 'sq_ft', 'area');
  const iRent = col('rent', 'monthly_rent', 'in_place_rent');
  const iMkt = col('market_rent', 'market');
  const iOcc = col('occupied', 'status');
  if (iId < 0 || iSf < 0 || iRent < 0 || iMkt < 0) {
    return { units: [], errors: ['Header needs at least: unit, sf, rent, market_rent (type and occupied optional).'] };
  }
  const units: Unit[] = [];
  rows.slice(1).forEach((r, k) => {
    const sf = toNumber(r[iSf]);
    const rent = toNumber(r[iRent]);
    const marketRent = toNumber(r[iMkt]);
    if ([sf, rent, marketRent].some((n) => !Number.isFinite(n) || n < 0)) {
      errors.push(`Row ${k + 2}: sf, rent and market_rent must be non-negative numbers.`);
      return;
    }
    const occRaw = (iOcc >= 0 ? (r[iOcc] ?? '') : '').trim().toLowerCase();
    const occupied = iOcc >= 0 ? !['n', 'no', 'false', '0', 'vacant'].includes(occRaw) : rent > 0;
    units.push({
      id: (r[iId] ?? '').trim() || `Unit ${k + 1}`,
      type: iType >= 0 ? (r[iType] ?? '').trim() : '',
      sf,
      rent: occupied ? rent : 0,
      marketRent,
      occupied,
    });
  });
  return { units, errors };
}

/* ---------- Operating statement ---------- */

export interface ExpenseLine {
  name: string;
  /** Annual dollars (ignored when pctOfEgi is set). */
  annual: number;
  /** When set, expense = pctOfEgi * EGI (management fee style). */
  pctOfEgi?: number;
}

export interface IncomeInput {
  pgi: number;
  vacancyPct: number;
  creditLossPct: number;
  otherIncome: number;
  expenses: ExpenseLine[];
}

export interface Operating {
  pgi: number;
  vacancyLoss: number;
  creditLoss: number;
  otherIncome: number;
  egi: number;
  expenseTotal: number;
  expenseAmounts: number[];
  noi: number;
}

export function operatingStatement(i: IncomeInput): Operating {
  const vacancyLoss = i.pgi * i.vacancyPct;
  const creditLoss = i.pgi * i.creditLossPct;
  const egi = i.pgi - vacancyLoss - creditLoss + i.otherIncome;
  const expenseAmounts = i.expenses.map((e) => (e.pctOfEgi !== undefined ? e.pctOfEgi * egi : e.annual));
  const expenseTotal = expenseAmounts.reduce((s, a) => s + a, 0);
  return { pgi: i.pgi, vacancyLoss, creditLoss, otherIncome: i.otherIncome, egi, expenseTotal, expenseAmounts, noi: egi - expenseTotal };
}

export interface Benchmark {
  name: string;
  lowPerSf: number;
  highPerSf: number;
}

export interface ExpenseCheck {
  name: string;
  amount: number;
  perUnit: number;
  perSf: number;
  pctOfEgi: number;
  low?: number;
  high?: number;
  flag: 'ok' | 'low' | 'high' | 'none';
}

export function checkExpenses(op: Operating, lines: ExpenseLine[], units: number, sf: number, benchmarks: Benchmark[]): ExpenseCheck[] {
  return lines.map((l, k) => {
    const amount = op.expenseAmounts[k] ?? 0;
    const perSf = sf > 0 ? amount / sf : 0;
    const b = benchmarks.find((x) => x.name.toLowerCase() === l.name.toLowerCase());
    let flag: ExpenseCheck['flag'] = 'none';
    if (b) flag = perSf < b.lowPerSf ? 'low' : perSf > b.highPerSf ? 'high' : 'ok';
    return {
      name: l.name,
      amount,
      perUnit: units > 0 ? amount / units : 0,
      perSf,
      pctOfEgi: op.egi > 0 ? amount / op.egi : 0,
      low: b?.lowPerSf,
      high: b?.highPerSf,
      flag,
    };
  });
}

/* ---------- Direct capitalization, cap rates, GRM ---------- */

export interface SaleComp {
  name: string;
  price: number;
  /** NOI at sale (verified, stabilized). */
  noi: number;
  /** Annual gross rent at sale, for GRM. */
  grossRent: number;
}

export interface Stats {
  n: number;
  mean: number;
  median: number;
  min: number;
  max: number;
}

export function stats(values: number[]): Stats {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const n = v.length;
  if (!n) return { n: 0, mean: NaN, median: NaN, min: NaN, max: NaN };
  const mid = Math.floor(n / 2);
  const median = n % 2 ? (v[mid] as number) : ((v[mid - 1] as number) + (v[mid] as number)) / 2;
  return { n, mean: v.reduce((s, x) => s + x, 0) / n, median, min: v[0] as number, max: v[n - 1] as number };
}

export const compCapRate = (c: SaleComp): number => (c.price > 0 ? c.noi / c.price : NaN);
export const compGrm = (c: SaleComp): number => (c.grossRent > 0 ? c.price / c.grossRent : NaN);

export function directCap(noi: number, capRate: number): number {
  if (capRate <= 0) throw new Error('cap rate must be positive');
  return noi / capRate;
}

export const grmValue = (grm: number, grossRent: number): number => grm * grossRent;

/* ---------- DCF ---------- */

export interface DcfInput {
  years: number;
  /** Year 1 potential gross income. */
  pgi: number;
  otherIncome: number;
  vacancyPct: number;
  creditLossPct: number;
  /** Year 1 expenses (may include pctOfEgi lines). */
  expenses: ExpenseLine[];
  rentGrowth: number;
  expenseGrowth: number;
  /** Capital reserve, year 1 dollars per sf. Deducted below NOI. */
  reservePerSf: number;
  sf: number;
  terminalCap: number;
  sellingCostPct: number;
  discountRate: number;
  /** Price paid for the IRR calculation. Defaults to the DCF present value. */
  price?: number;
}

export interface DcfYear {
  year: number;
  pgi: number;
  egi: number;
  expenses: number;
  noi: number;
  reserve: number;
  cashFlow: number;
}

export interface DcfResult {
  rows: DcfYear[];
  /** NOI of year N+1, capitalized for the sale. */
  forwardNoi: number;
  grossReversion: number;
  netReversion: number;
  pvCashFlows: number;
  pvReversion: number;
  presentValue: number;
  price: number;
  irr: number;
  npv: number;
}

/** PV of year-end cash flows (years 1..N) plus a net reversion at year N. */
export function pvOf(cashFlows: number[], netReversion: number, rate: number): number {
  const all = [0, ...cashFlows];
  all[all.length - 1] = (all[all.length - 1] as number) + netReversion;
  return npv(rate, all);
}

export function runDcf(i: DcfInput): DcfResult {
  if (i.years < 1 || !Number.isInteger(i.years)) throw new Error('years must be a whole number >= 1');
  if (i.terminalCap <= 0) throw new Error('terminal cap must be positive');
  const year = (t: number): DcfYear => {
    const rg = Math.pow(1 + i.rentGrowth, t - 1);
    const eg = Math.pow(1 + i.expenseGrowth, t - 1);
    const op = operatingStatement({
      pgi: i.pgi * rg,
      otherIncome: i.otherIncome * rg,
      vacancyPct: i.vacancyPct,
      creditLossPct: i.creditLossPct,
      expenses: i.expenses.map((e) => (e.pctOfEgi !== undefined ? e : { ...e, annual: e.annual * eg })),
    });
    const reserve = i.reservePerSf * i.sf * eg;
    return { year: t, pgi: op.pgi, egi: op.egi, expenses: op.expenseTotal, noi: op.noi, reserve, cashFlow: op.noi - reserve };
  };
  const rows = Array.from({ length: i.years }, (_, k) => year(k + 1));
  const forwardNoi = year(i.years + 1).noi;
  const grossReversion = forwardNoi / i.terminalCap;
  const netReversion = grossReversion * (1 - i.sellingCostPct);
  const cfs = rows.map((r) => r.cashFlow);
  const presentValue = pvOf(cfs, netReversion, i.discountRate);
  const pvReversion = netReversion / Math.pow(1 + i.discountRate, i.years);
  const price = i.price ?? presentValue;
  const flows = [-price, ...cfs];
  flows[flows.length - 1] = (flows[flows.length - 1] as number) + netReversion;
  return {
    rows,
    forwardNoi,
    grossReversion,
    netReversion,
    pvCashFlows: presentValue - pvReversion,
    pvReversion,
    presentValue,
    price,
    irr: irr(flows),
    npv: presentValue - price,
  };
}

/* ---------- Sensitivity ---------- */

export interface SensitivityGrid {
  caps: number[];
  vacancies: number[];
  /** values[vacancyIndex][capIndex] */
  values: number[][];
}

export function sensitivity(base: IncomeInput, caps: number[], vacancies: number[]): SensitivityGrid {
  const values = vacancies.map((v) => caps.map((c) => directCap(operatingStatement({ ...base, vacancyPct: v }).noi, c)));
  return { caps, vacancies, values };
}

/* ---------- Reconciliation ---------- */

export interface Indication {
  name: string;
  value: number;
  weight: number;
}

export interface Reconciled {
  weights: number[];
  value: number;
  low: number;
  high: number;
  spreadPct: number;
}

export function reconcile(ind: Indication[]): Reconciled {
  const used = ind.filter((x) => Number.isFinite(x.value) && x.weight > 0);
  const total = used.reduce((s, x) => s + x.weight, 0);
  if (!used.length || total <= 0) return { weights: ind.map(() => 0), value: NaN, low: NaN, high: NaN, spreadPct: NaN };
  const weights = ind.map((x) => (Number.isFinite(x.value) && x.weight > 0 ? x.weight / total : 0));
  const value = used.reduce((s, x) => s + x.value * (x.weight / total), 0);
  const vals = ind.filter((x) => Number.isFinite(x.value)).map((x) => x.value);
  const low = Math.min(...vals);
  const high = Math.max(...vals);
  return { weights, value, low, high, spreadPct: value > 0 ? (high - low) / value : NaN };
}

export const roundTo = (v: number, step: number): number => Math.round(v / step) * step;
