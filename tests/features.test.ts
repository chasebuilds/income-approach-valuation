import { describe, expect, it } from 'vitest';
import { dcrCapRate, mortgageConstant } from '../src/lib/finance';
import { fromJson, summaryCsv, toJson } from '../src/lib/io';
import { asIsValue, leaseUpLoss, type Unit } from '../src/lib/valuation';
import { fourplex, scenarios, stripRetail } from '../src/data/samples';

describe('debt coverage ratio cap rate', () => {
  it('1.25 x 0.75 x 0.0719461 = 0.0674495 (6%, 30 years)', () => {
    // 1.25 x 0.75 = 0.9375; 0.9375 x 0.0719461 = 0.06744947
    expect(dcrCapRate(1.25, 0.75, 0.06, 30)).toBeCloseTo(0.0674495, 6);
  });
  it('equals DCR x LTV x mortgage constant', () => {
    expect(dcrCapRate(1.3, 0.65, 0.0725, 20)).toBeCloseTo(1.3 * 0.65 * mortgageConstant(0.0725, 20), 12);
  });
  it('zero loan gives a zero cap rate component', () => {
    expect(dcrCapRate(1.25, 0, 0.06, 30)).toBe(0);
  });
  it('rejects a non-positive coverage ratio and a bad loan to value', () => {
    expect(() => dcrCapRate(0, 0.75, 0.06, 30)).toThrow();
    expect(() => dcrCapRate(1.25, 1.5, 0.06, 30)).toThrow();
  });
});

describe('stabilized to as-is', () => {
  const u = (rent: number, market: number, occupied: boolean): Unit => ({ id: 'x', type: '', sf: 700, rent, marketRent: market, occupied });
  it('lease-up loss counts only vacant units: (750 + 800) x 3 = 4,650', () => {
    expect(leaseUpLoss([u(700, 725, true), u(0, 750, false), u(0, 800, false)], 3)).toBe(4650);
  });
  it('no vacancy or negative months gives zero', () => {
    expect(leaseUpLoss([u(700, 725, true)], 6)).toBe(0);
    expect(leaseUpLoss([u(0, 750, false)], -2)).toBe(0);
  });
  it('as-is = 287,000 - 2,250 - 3,500 = 281,250', () => {
    expect(asIsValue(287000, 2250, [{ name: 'Deferred maintenance', amount: 3500 }])).toBe(281250);
  });
  it('several deductions add: 500,000 - 10,000 - (4,800 + 18,000) = 467,200', () => {
    expect(
      asIsValue(500000, 10000, [
        { name: 'Commission', amount: 4800 },
        { name: 'TI', amount: 18000 },
      ]),
    ).toBe(467200);
  });
  it('built-in fourplex: one vacant unit, 750 x 3 months = 2,250', () => {
    expect(leaseUpLoss(fourplex.units, fourplex.leaseUpMonths)).toBe(2250);
  });
  it('built-in strip: bay 4 vacant, 2,400 x 6 months = 14,400', () => {
    expect(leaseUpLoss(stripRetail.units, stripRetail.leaseUpMonths)).toBe(14400);
  });
});

describe('scenario save and load', () => {
  it('round trips every built-in scenario unchanged', () => {
    for (const s of scenarios) {
      const back = fromJson(toJson(s));
      expect(back.error).toBeUndefined();
      expect(back.scenario).toEqual(s);
    }
  });
  it('rejects text that is not JSON', () => {
    expect(fromJson('not json').error).toMatch(/JSON/);
  });
  it('rejects JSON from some other app', () => {
    expect(fromJson('{"app":"other","scenario":{}}').error).toMatch(/Not a saved/);
  });
  it('names the missing or wrong field', () => {
    const bad = JSON.parse(toJson(fourplex));
    bad.scenario.vacancyPct = 'five';
    expect(fromJson(JSON.stringify(bad)).error).toMatch(/vacancyPct/);
    const bad2 = JSON.parse(toJson(fourplex));
    delete bad2.scenario.units;
    expect(fromJson(JSON.stringify(bad2)).error).toMatch(/units/);
  });
});

describe('summary csv', () => {
  it('writes a header and quotes commas and quotes', () => {
    const csv = summaryCsv([
      ['property', 'scenario', 'Fourplex, "synthetic"'],
      ['value', 'noi', 23337],
    ]);
    expect(csv).toBe('section,item,value\nproperty,scenario,"Fourplex, ""synthetic"""\nvalue,noi,23337\n');
  });
});
