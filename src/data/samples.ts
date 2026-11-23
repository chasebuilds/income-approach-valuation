import type { ExpenseLine, SaleComp, Unit, RentBasis } from '../lib/valuation';

/** Expense line plus an optional benchmark range in $ per sf per year. */
export interface ExpenseRow extends ExpenseLine {
  low?: number;
  high?: number;
}

export interface Scenario {
  id: string;
  name: string;
  blurb: string;
  units: Unit[];
  basis: RentBasis;
  vacancyPct: number;
  creditLossPct: number;
  otherIncome: number;
  otherIncomeNote: string;
  expenses: ExpenseRow[];
  comps: SaleComp[];
  selectedCap: number;
  selectedGrm: number;
  band: { ltv: number; rate: number; years: number; equityDividend: number };
  dcf: {
    years: number;
    rentGrowth: number;
    expenseGrowth: number;
    reservePerSf: number;
    terminalCap: number;
    sellingCostPct: number;
    discountRate: number;
  };
  weights: { direct: number; grm: number; dcf: number };
  /** Months to lease currently vacant units, for the as-is adjustment. */
  leaseUpMonths: number;
  /** Other as-is deductions: deferred maintenance, leasing costs, and similar. */
  adjustments: { name: string; amount: number }[];
  /** Debt coverage ratio a lender requires, for the DCR cap rate method. */
  dcr: number;
  sensitivityCapStep: number;
  sensitivityVacStep: number;
}

const unit = (id: string, type: string, sf: number, rent: number, marketRent: number, occupied = true): Unit => ({
  id,
  type,
  sf,
  rent: occupied ? rent : 0,
  marketRent,
  occupied,
});

/** All values below are synthetic. No real property, owner or address. */
export const fourplex: Scenario = {
  id: 'fourplex',
  name: 'Sample fourplex (synthetic)',
  blurb: 'Four 2BR/1BA units, one vacant, in-place rents a little under market.',
  units: [
    unit('Unit 1', '2BR/1BA', 750, 700, 750),
    unit('Unit 2', '2BR/1BA', 750, 725, 750),
    unit('Unit 3', '2BR/1BA', 750, 695, 750),
    unit('Unit 4', '2BR/1BA', 750, 0, 750, false),
  ],
  basis: 'market',
  vacancyPct: 0.05,
  creditLossPct: 0.01,
  otherIncome: 1200,
  otherIncomeNote: 'Coin laundry, about $100 a month',
  expenses: [
    { name: 'Real estate taxes', annual: 2400, low: 0.5, high: 1.1 },
    { name: 'Insurance', annual: 1900, low: 0.4, high: 0.9 },
    { name: 'Utilities (common)', annual: 1500, low: 0.3, high: 0.8 },
    { name: 'Repairs and maintenance', annual: 2200, low: 0.4, high: 1.0 },
    { name: 'Lawn and snow', annual: 500, low: 0.1, high: 0.3 },
    { name: 'Admin and legal', annual: 400, low: 0.05, high: 0.25 },
    { name: 'Management', annual: 0, pctOfEgi: 0.08 },
  ],
  comps: [
    { name: 'Sale A', price: 285000, noi: 23100, grossRent: 35400 },
    { name: 'Sale B', price: 310000, noi: 24100, grossRent: 38400 },
    { name: 'Sale C', price: 262000, noi: 22000, grossRent: 33600 },
    { name: 'Sale D', price: 330000, noi: 25600, grossRent: 40800 },
    { name: 'Sale E', price: 298000, noi: 23800, grossRent: 36600 },
  ],
  selectedCap: 0.08,
  selectedGrm: 8,
  band: { ltv: 0.7, rate: 0.0675, years: 25, equityDividend: 0.08 },
  dcf: { years: 5, rentGrowth: 0.025, expenseGrowth: 0.03, reservePerSf: 0.3, terminalCap: 0.085, sellingCostPct: 0.03, discountRate: 0.095 },
  weights: { direct: 50, grm: 20, dcf: 30 },
  leaseUpMonths: 3,
  adjustments: [{ name: 'Deferred maintenance (roof patch, unit 4 paint)', amount: 3500 }],
  dcr: 1.25,
  sensitivityCapStep: 0.005,
  sensitivityVacStep: 0.025,
};

export const stripRetail: Scenario = {
  id: 'strip',
  name: 'Sample strip retail (synthetic)',
  blurb: 'Four-bay strip center, one bay vacant, tenants reimburse most operating costs.',
  units: [
    unit('Bay 1', 'Inline', 2000, 2000, 2100),
    unit('Bay 2', 'Inline', 1600, 1600, 1700),
    unit('Bay 3', 'Inline', 1800, 1725, 1800),
    unit('Bay 4', 'End cap', 2400, 0, 2400, false),
  ],
  basis: 'market',
  vacancyPct: 0.1,
  creditLossPct: 0.02,
  otherIncome: 14000,
  otherIncomeNote: 'Tenant reimbursements of taxes, insurance and common area costs',
  expenses: [
    { name: 'Real estate taxes', annual: 9000, low: 0.6, high: 1.5 },
    { name: 'Insurance', annual: 3000, low: 0.2, high: 0.6 },
    { name: 'Common area maintenance', annual: 6500, low: 0.5, high: 1.2 },
    { name: 'Admin and legal', annual: 1200, low: 0.05, high: 0.3 },
    { name: 'Management', annual: 0, pctOfEgi: 0.04 },
  ],
  comps: [
    { name: 'Sale A', price: 760000, noi: 66900, grossRent: 84000 },
    { name: 'Sale B', price: 905000, noi: 76400, grossRent: 99500 },
    { name: 'Sale C', price: 640000, noi: 59500, grossRent: 72000 },
    { name: 'Sale D', price: 1050000, noi: 88200, grossRent: 118000 },
  ],
  selectedCap: 0.0875,
  selectedGrm: 8.95,
  band: { ltv: 0.65, rate: 0.0725, years: 20, equityDividend: 0.09 },
  dcf: { years: 7, rentGrowth: 0.02, expenseGrowth: 0.025, reservePerSf: 0.25, terminalCap: 0.0925, sellingCostPct: 0.03, discountRate: 0.105 },
  weights: { direct: 55, grm: 15, dcf: 30 },
  leaseUpMonths: 6,
  adjustments: [
    { name: 'Leasing commission, bay 4', amount: 4800 },
    { name: 'Tenant improvements, bay 4', amount: 18000 },
  ],
  dcr: 1.3,
  sensitivityCapStep: 0.005,
  sensitivityVacStep: 0.025,
};

export const scenarios: Scenario[] = [fourplex, stripRetail];

export const rentRollTemplate =
  'unit,type,sf,rent,market_rent,occupied\n' +
  'Unit 1,2BR/1BA,750,700,750,yes\n' +
  'Unit 2,2BR/1BA,750,725,750,yes\n' +
  'Unit 3,2BR/1BA,750,695,750,yes\n' +
  'Unit 4,2BR/1BA,750,0,750,no\n';
