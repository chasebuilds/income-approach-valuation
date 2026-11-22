/** Core finance formulas. Rates are decimals (0.06 = 6%). */

/** Payment per period per $1 of loan. */
export function paymentFactor(annualRate: number, years: number, paymentsPerYear = 12): number {
  const n = years * paymentsPerYear;
  if (n <= 0) throw new Error('term must be positive');
  const r = annualRate / paymentsPerYear;
  if (r === 0) return 1 / n;
  return r / (1 - Math.pow(1 + r, -n));
}

/** Mortgage constant (annual debt service per $1 of loan). */
export function mortgageConstant(annualRate: number, years: number, paymentsPerYear = 12): number {
  return paymentFactor(annualRate, years, paymentsPerYear) * paymentsPerYear;
}

export interface BandInput {
  /** Loan to value, 0..1 */
  ltv: number;
  rate: number;
  years: number;
  /** Equity dividend rate (cash on cash) the equity investor requires. */
  equityDividend: number;
}

export interface BandResult {
  mortgageConstant: number;
  mortgageComponent: number;
  equityComponent: number;
  capRate: number;
}

/** Band of investment (mortgage-equity) overall cap rate: Rm*M + Re*(1-M). */
export function bandOfInvestment(i: BandInput): BandResult {
  if (i.ltv < 0 || i.ltv > 1) throw new Error('ltv must be between 0 and 1');
  const rm = mortgageConstant(i.rate, i.years);
  const mortgageComponent = i.ltv * rm;
  const equityComponent = (1 - i.ltv) * i.equityDividend;
  return { mortgageConstant: rm, mortgageComponent, equityComponent, capRate: mortgageComponent + equityComponent };
}

/** NPV where cashflows[0] occurs at t=0. */
export function npv(rate: number, cashflows: number[]): number {
  return cashflows.reduce((s, cf, t) => s + cf / Math.pow(1 + rate, t), 0);
}

/**
 * IRR by bisection on [-0.99, 10]. Returns NaN when there is no sign change
 * (no real IRR in range). Bisection is slower than Newton but cannot diverge.
 */
export function irr(cashflows: number[]): number {
  let lo = -0.99;
  let hi = 10;
  let fLo = npv(lo, cashflows);
  const fHi = npv(hi, cashflows);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) return NaN;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid, cashflows);
    if (Math.abs(fMid) < 1e-9 || hi - lo < 1e-12) return mid;
    if (fLo * fMid < 0) hi = mid;
    else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}
