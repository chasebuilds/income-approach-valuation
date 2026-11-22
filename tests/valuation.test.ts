import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/lib/csv';
import {
  checkExpenses,
  compCapRate,
  compGrm,
  directCap,
  grmValue,
  operatingStatement,
  parseRentRollCsv,
  pvOf,
  reconcile,
  runDcf,
  sensitivity,
  stats,
  summarizeRentRoll,
  type DcfInput,
} from '../src/lib/valuation';

describe('csv', () => {
  it('handles quotes, escaped quotes and CRLF', () => {
    expect(parseCsv('a,"b,c","d ""x"""\r\n1,2,3\r\n')).toEqual([
      ['a', 'b,c', 'd "x"'],
      ['1', '2', '3'],
    ]);
  });
});

describe('rent roll', () => {
  const csv = 'unit,type,sf,rent,market_rent,occupied\nA,2BR,900,"1,000",1100,yes\nB,2BR,900,0,1100,no\n';
  it('parses CSV and treats a vacant unit as zero rent', () => {
    const { units, errors } = parseRentRollCsv(csv);
    expect(errors).toEqual([]);
    expect(units).toHaveLength(2);
    expect(units[0]?.rent).toBe(1000);
    expect(units[1]?.occupied).toBe(false);
  });
  it('summarizes: scheduled = 1000*12 + 1100*12 = 25,200; market = 26,400; mtm = 1,200', () => {
    const s = summarizeRentRoll(parseRentRollCsv(csv).units);
    expect(s.scheduledAnnual).toBe(25200);
    expect(s.marketAnnual).toBe(26400);
    expect(s.mtm).toBe(1200);
    expect(s.physicalOccupancy).toBe(0.5);
    expect(s.sf).toBe(1800);
  });
  it('reports bad rows and bad headers', () => {
    expect(parseRentRollCsv('unit,sf,rent,market_rent\nA,abc,1,1\n').errors[0]).toMatch(/Row 2/);
    expect(parseRentRollCsv('foo,bar\n1,2\n').errors[0]).toMatch(/Header/);
  });
});

describe('operating statement', () => {
  // PGI 100,000; vacancy 5% = 5,000; credit 1% = 1,000; other 2,000 -> EGI 96,000.
  // Management 5% of EGI = 4,800; fixed 30,000 -> expenses 34,800; NOI 61,200.
  const input = {
    pgi: 100000,
    vacancyPct: 0.05,
    creditLossPct: 0.01,
    otherIncome: 2000,
    expenses: [
      { name: 'Taxes', annual: 30000 },
      { name: 'Management', annual: 0, pctOfEgi: 0.05 },
    ],
  };
  it('computes EGI, expenses and NOI', () => {
    const op = operatingStatement(input);
    expect(op.egi).toBeCloseTo(96000, 6);
    expect(op.expenseTotal).toBeCloseTo(34800, 6);
    expect(op.noi).toBeCloseTo(61200, 6);
  });
  it('direct cap: 61,200 / 0.08 = 765,000', () => {
    expect(directCap(61200, 0.08)).toBeCloseTo(765000, 6);
  });
  it('rejects a zero cap rate', () => {
    expect(() => directCap(1, 0)).toThrow();
  });
  it('per-unit and per-sf checks flag a line outside its range', () => {
    const op = operatingStatement(input);
    // Taxes 30,000 over 10,000 sf = 3.00/sf, 4 units = 7,500/unit, 30,000/96,000 = 31.25% of EGI.
    const [taxes] = checkExpenses(op, input.expenses, 4, 10000, [{ name: 'taxes', lowPerSf: 0.5, highPerSf: 2.5 }]);
    expect(taxes?.perSf).toBeCloseTo(3, 9);
    expect(taxes?.perUnit).toBeCloseTo(7500, 9);
    expect(taxes?.pctOfEgi).toBeCloseTo(0.3125, 9);
    expect(taxes?.flag).toBe('high');
  });
});

describe('comps', () => {
  const comp = { name: 'C1', price: 800000, noi: 56000, grossRent: 100000 };
  it('cap rate 56,000 / 800,000 = 7%; GRM 800,000 / 100,000 = 8', () => {
    expect(compCapRate(comp)).toBeCloseTo(0.07, 12);
    expect(compGrm(comp)).toBeCloseTo(8, 12);
  });
  it('GRM value: 8 x 95,000 = 760,000', () => {
    expect(grmValue(8, 95000)).toBe(760000);
  });
  it('stats: odd and even medians', () => {
    expect(stats([0.07, 0.09, 0.08]).median).toBeCloseTo(0.08, 12);
    expect(stats([1, 2, 3, 4]).median).toBe(2.5);
    expect(stats([1, 2, 3, 4]).mean).toBe(2.5);
    expect(stats([]).n).toBe(0);
  });
});

describe('dcf', () => {
  const base: DcfInput = {
    years: 5,
    pgi: 100000,
    otherIncome: 0,
    vacancyPct: 0.05,
    creditLossPct: 0,
    expenses: [{ name: 'Opex', annual: 40000 }],
    rentGrowth: 0,
    expenseGrowth: 0,
    reservePerSf: 0,
    sf: 10000,
    terminalCap: 0.1,
    sellingCostPct: 0,
    discountRate: 0.1,
  };

  it('pvOf: 100/yr for 3 years plus 1,000 reversion at 10% is exactly 1,000', () => {
    // 100/1.1 + 100/1.21 + 100/1.331 + 1000/1.331 = 90.909 + 82.645 + 75.131 + 751.315
    expect(pvOf([100, 100, 100], 1000, 0.1)).toBeCloseTo(1000, 6);
  });

  it('flat NOI 55,000, terminal cap = discount rate: value 550,000, IRR 10%, NPV 0', () => {
    // 55,000 x 3.790787 (5y annuity at 10%) = 208,493 + 550,000 / 1.61051 = 341,507 -> 550,000
    const r = runDcf(base);
    expect(r.rows[0]?.noi).toBeCloseTo(55000, 6);
    expect(r.grossReversion).toBeCloseTo(550000, 6);
    expect(r.presentValue).toBeCloseTo(550000, 4);
    expect(r.irr).toBeCloseTo(0.1, 8);
    expect(r.npv).toBeCloseTo(0, 4);
  });

  it('rent growth 3%, 2 years, terminal cap 8%: PV 789,359.50', () => {
    // NOI: 60,000, 63,000; year 3 NOI 66,090; reversion 66,090 / 0.08 = 826,125.
    // PV = 60,000/1.1 + 63,000/1.21 + 826,125/1.21 = 54,545.45 + 52,066.12 + 682,747.93
    const r = runDcf({ ...base, years: 2, vacancyPct: 0, rentGrowth: 0.03, terminalCap: 0.08 });
    expect(r.rows.map((x) => x.noi)).toEqual([60000, 63000].map((v) => expect.closeTo(v, 6)));
    expect(r.forwardNoi).toBeCloseTo(66090, 6);
    expect(r.grossReversion).toBeCloseTo(826125, 4);
    expect(r.presentValue).toBeCloseTo(789359.5, 0);
  });

  it('capital reserve 0.25/sf on 10,000 sf cuts cash flow to 52,500: PV 540,523', () => {
    // 52,500 x 3.790787 = 199,016.3 ; reversion unchanged at 341,506.7
    const r = runDcf({ ...base, reservePerSf: 0.25 });
    expect(r.rows[0]?.cashFlow).toBeCloseTo(52500, 6);
    expect(Math.abs(r.presentValue - 540523)).toBeLessThan(1);
  });

  it('selling costs of 2% reduce the reversion: 550,000 x 0.98 = 539,000', () => {
    expect(runDcf({ ...base, sellingCostPct: 0.02 }).netReversion).toBeCloseTo(539000, 6);
  });

  it('IRR at a price above value is below the discount rate; below value it is above', () => {
    expect(runDcf({ ...base, price: 600000 }).irr).toBeLessThan(0.1);
    expect(runDcf({ ...base, price: 500000 }).irr).toBeGreaterThan(0.1);
  });

  it('expense growth applies to fixed lines but percent-of-EGI lines follow income', () => {
    const r = runDcf({
      ...base,
      years: 2,
      vacancyPct: 0,
      expenseGrowth: 0.05,
      expenses: [
        { name: 'Fixed', annual: 40000 },
        { name: 'Mgmt', annual: 0, pctOfEgi: 0.05 },
      ],
    });
    // Year 1: 100,000 - 40,000 - 5,000 = 55,000. Year 2: 100,000 - 42,000 - 5,000 = 53,000.
    expect(r.rows[0]?.noi).toBeCloseTo(55000, 6);
    expect(r.rows[1]?.noi).toBeCloseTo(53000, 6);
  });

  it('rejects bad years and terminal cap', () => {
    expect(() => runDcf({ ...base, years: 0 })).toThrow();
    expect(() => runDcf({ ...base, terminalCap: 0 })).toThrow();
  });
});

describe('sensitivity', () => {
  const inc = { pgi: 100000, vacancyPct: 0.05, creditLossPct: 0, otherIncome: 0, expenses: [{ name: 'Opex', annual: 40000 }] };
  it('value grid: vacancy 5% / 10%, cap 8% / 10%', () => {
    const g = sensitivity(inc, [0.08, 0.1], [0.05, 0.1]);
    // 5%: NOI 55,000 -> 687,500 at 8%, 550,000 at 10%. 10%: NOI 50,000 -> 625,000 and 500,000.
    expect(g.values[0]).toEqual([expect.closeTo(687500, 6), expect.closeTo(550000, 6)]);
    expect(g.values[1]).toEqual([expect.closeTo(625000, 6), expect.closeTo(500000, 6)]);
  });
});

describe('reconcile', () => {
  it('weights 50/20/30 on 800k / 700k / 900k: 400k + 140k + 270k = 810k', () => {
    const r = reconcile([
      { name: 'Direct', value: 800000, weight: 5 },
      { name: 'GRM', value: 700000, weight: 2 },
      { name: 'DCF', value: 900000, weight: 3 },
    ]);
    expect(r.value).toBeCloseTo(810000, 6);
    expect(r.low).toBe(700000);
    expect(r.high).toBe(900000);
    expect(r.spreadPct).toBeCloseTo(200000 / 810000, 9);
  });
  it('ignores indications with zero weight or no value and renormalizes', () => {
    const r = reconcile([
      { name: 'A', value: 800000, weight: 1 },
      { name: 'B', value: NaN, weight: 1 },
      { name: 'C', value: 600000, weight: 0 },
    ]);
    expect(r.value).toBe(800000);
    expect(r.weights).toEqual([1, 0, 0]);
  });
});
