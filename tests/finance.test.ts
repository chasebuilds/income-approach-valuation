import { describe, expect, it } from 'vitest';
import { bandOfInvestment, irr, mortgageConstant, npv, paymentFactor } from '../src/lib/finance';

describe('mortgage constant', () => {
  it('6% 30 years monthly: payment factor 0.0059955, constant 0.0719461', () => {
    // r = 0.06/12 = 0.005, n = 360. 1.005^360 = 6.022575, so 1 - 1/6.022575 = 0.833958.
    // factor = 0.005 / 0.833958 = 0.0059955. Constant = 12 * factor = 0.0719461.
    expect(paymentFactor(0.06, 30)).toBeCloseTo(0.0059955, 7);
    expect(mortgageConstant(0.06, 30)).toBeCloseTo(0.0719461, 6);
  });
  it('0% rate: straight line, 10 years gives 0.10', () => {
    expect(mortgageConstant(0, 10)).toBeCloseTo(0.1, 12);
  });
  it('rejects a zero term', () => {
    expect(() => mortgageConstant(0.06, 0)).toThrow();
  });
});

describe('band of investment', () => {
  it('75% loan at 6%/30y, 8% equity dividend: 0.75*0.0719461 + 0.25*0.08 = 0.0739596', () => {
    const r = bandOfInvestment({ ltv: 0.75, rate: 0.06, years: 30, equityDividend: 0.08 });
    expect(r.mortgageComponent).toBeCloseTo(0.0539596, 6);
    expect(r.equityComponent).toBeCloseTo(0.02, 12);
    expect(r.capRate).toBeCloseTo(0.0739596, 6);
  });
  it('0% loan returns the equity dividend rate', () => {
    expect(bandOfInvestment({ ltv: 0, rate: 0.06, years: 30, equityDividend: 0.09 }).capRate).toBeCloseTo(0.09, 12);
  });
  it('rejects ltv above 1', () => {
    expect(() => bandOfInvestment({ ltv: 1.2, rate: 0.06, years: 30, equityDividend: 0.09 })).toThrow();
  });
});

describe('npv', () => {
  it('-100 now, 110 in a year at 10% is 0', () => {
    expect(npv(0.1, [-100, 110])).toBeCloseTo(0, 10);
  });
  it('-100, 50, 60 at 10%: -100 + 45.4545 + 49.5868 = -4.9587', () => {
    expect(npv(0.1, [-100, 50, 60])).toBeCloseTo(-4.9587, 4);
  });
});

describe('irr', () => {
  it('-100 then 110 is 10%', () => {
    expect(irr([-100, 110])).toBeCloseTo(0.1, 8);
  });
  it('-100, 0, 121 is 10% (121 / 1.1^2 = 100)', () => {
    expect(irr([-100, 0, 121])).toBeCloseTo(0.1, 8);
  });
  it('par bond: -1000, 100, 100, 1100 is 10%', () => {
    expect(irr([-1000, 100, 100, 1100])).toBeCloseTo(0.1, 8);
  });
  it('negative return: -100 then 90 is -10%', () => {
    expect(irr([-100, 90])).toBeCloseTo(-0.1, 8);
  });
  it('returns NaN when there is no sign change', () => {
    expect(irr([100, 100, 100])).toBeNaN();
  });
});
