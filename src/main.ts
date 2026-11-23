import './style.css';
import { bandOfInvestment, dcrCapRate } from './lib/finance';
import { fromJson, summaryCsv, toJson } from './lib/io';
import {
  asIsValue,
  checkExpenses,
  leaseUpLoss,
  compCapRate,
  compGrm,
  directCap,
  grmValue,
  operatingStatement,
  parseRentRollCsv,
  reconcile,
  roundTo,
  runDcf,
  sensitivity,
  stats,
  summarizeRentRoll,
  type Adjustment,
  type SaleComp,
  type Unit,
} from './lib/valuation';
import { rentRollTemplate, scenarios, type ExpenseRow, type Scenario } from './data/samples';
import { esc, grid, int, kv, mult, pct, toPctText, usd, usd2, type Grid } from './ui';

interface State extends Scenario {
  dcfPrice: number | null;
}

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

let state: State = load(scenarios[0] as Scenario);
let rentGrid: Grid;
let expGrid: Grid;
let compGridH: Grid;

function load(s: Scenario): State {
  return { ...structuredClone(s), dcfPrice: null };
}

/* ---------- binding of plain inputs to state paths ---------- */

type Rec = Record<string, unknown>;
function getPath(path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Rec)[k], state);
}
function setPath(path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop() as string;
  const target = keys.reduce<unknown>((o, k) => (o as Rec)[k], state) as Rec;
  target[last] = value;
}

function bindInputs(): void {
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-bind]').forEach((el) => {
    const path = el.dataset.bind as string;
    const kind = el.dataset.kind ?? 'text';
    const ev = el instanceof HTMLSelectElement ? 'change' : 'input';
    el.addEventListener(ev, () => {
      const raw = el.value.trim();
      let v: unknown = raw;
      if (kind === 'pct') v = Number.isFinite(Number(raw)) && raw !== '' ? Number(raw) / 100 : 0;
      else if (kind === 'num') v = Number.isFinite(Number(raw)) && raw !== '' ? Number(raw) : 0;
      else if (kind === 'optnum') v = raw === '' || !Number.isFinite(Number(raw)) ? null : Number(raw);
      setPath(path, v);
      update();
    });
  });
}

function syncInputs(): void {
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-bind]').forEach((el) => {
    const v = getPath(el.dataset.bind as string);
    const kind = el.dataset.kind ?? 'text';
    if (kind === 'pct') el.value = toPctText(v as number);
    else if (kind === 'optnum') el.value = v === null ? '' : String(v);
    else el.value = String(v ?? '');
  });
}

/* ---------- grids ---------- */

function mountGrids(): void {
  rentGrid = grid<Unit>(
    $('rent-grid'),
    [
      { label: 'Unit', key: 'id', kind: 'text' },
      { label: 'Type', key: 'type', kind: 'text' },
      { label: 'SF', key: 'sf', kind: 'num' },
      { label: 'Occupied', key: 'occupied', kind: 'bool' },
      { label: 'In-place rent / mo', key: 'rent', kind: 'num' },
      { label: 'Market rent / mo', key: 'marketRent', kind: 'num' },
      { label: 'Market vs in-place', calc: (u) => (u.occupied && u.rent > 0 ? signed((u.marketRent - u.rent) / u.rent) : u.occupied ? 'n/a' : 'vacant'), cls: (u) => (u.occupied && u.rent > 0 && (u.marketRent - u.rent) / u.rent > 0.05 ? 'warn' : '') },
      { label: 'Market $/sf/yr', calc: (u) => (u.sf > 0 ? usd2((u.marketRent * 12) / u.sf) : 'n/a') },
    ],
    state.units,
    update,
    { newRow: () => ({ id: `Unit ${state.units.length + 1}`, type: '', sf: 0, rent: 0, marketRent: 0, occupied: true }), addLabel: 'Add unit' },
  );

  expGrid = grid<ExpenseRow>(
    $('exp-grid'),
    [
      { label: 'Expense', key: 'name', kind: 'text' },
      { label: '$ per year', key: 'annual', kind: 'num' },
      { label: '% of EGI', key: 'pctOfEgi', kind: 'pct', optional: true },
      { label: 'Used', calc: (_r, i) => usd(lastOp.expenseAmounts[i] ?? 0) },
      { label: '$ / unit', calc: (_r, i) => usd(lastChecks[i]?.perUnit ?? NaN) },
      { label: '$ / sf', calc: (_r, i) => usd2(lastChecks[i]?.perSf ?? NaN) },
      { label: '% of EGI used', calc: (_r, i) => pct(lastChecks[i]?.pctOfEgi ?? NaN, 1) },
      { label: 'Low $/sf', key: 'low', kind: 'num', optional: true },
      { label: 'High $/sf', key: 'high', kind: 'num', optional: true },
      { label: 'Check', calc: (_r, i) => flagText(lastChecks[i]?.flag), cls: (_r, i) => (lastChecks[i]?.flag === 'ok' ? 'good' : lastChecks[i]?.flag === 'none' ? '' : 'warn') },
    ],
    state.expenses,
    update,
    { newRow: () => ({ name: 'New expense', annual: 0 }), addLabel: 'Add expense' },
  );

  compGridH = grid<SaleComp>(
    $('comp-grid'),
    [
      { label: 'Sale', key: 'name', kind: 'text' },
      { label: 'Price', key: 'price', kind: 'num' },
      { label: 'NOI', key: 'noi', kind: 'num' },
      { label: 'Gross rent / yr', key: 'grossRent', kind: 'num' },
      { label: 'Cap rate', calc: (c) => pct(compCapRate(c)) },
      { label: 'GRM', calc: (c) => mult(compGrm(c)) },
    ],
    state.comps,
    update,
    { newRow: () => ({ name: `Sale ${String.fromCharCode(65 + state.comps.length)}`, price: 0, noi: 0, grossRent: 0 }), addLabel: 'Add sale' },
  );

  grid<Adjustment>(
    $('adj-grid'),
    [
      { label: 'Deduction', key: 'name', kind: 'text' },
      { label: '$', key: 'amount', kind: 'num' },
    ],
    state.adjustments,
    update,
    { newRow: () => ({ name: 'New deduction', amount: 0 }), addLabel: 'Add deduction' },
  );
}

function signed(v: number): string {
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
}
function flagText(f: string | undefined): string {
  return f === 'ok' ? 'in range' : f === 'high' ? 'above range' : f === 'low' ? 'below range' : '';
}

/* ---------- calculation and render ---------- */

let lastOp = operatingStatement({ pgi: 0, vacancyPct: 0, creditLossPct: 0, otherIncome: 0, expenses: [] });
let lastChecks: ReturnType<typeof checkExpenses> = [];

function update(): void {
  const rr = summarizeRentRoll(state.units);
  const pgi = state.basis === 'market' ? rr.marketAnnual : rr.scheduledAnnual;
  const income = { pgi, vacancyPct: state.vacancyPct, creditLossPct: state.creditLossPct, otherIncome: state.otherIncome, expenses: state.expenses };
  const op = operatingStatement(income);
  lastOp = op;
  const benchmarks = state.expenses.filter((e) => e.low !== undefined && e.high !== undefined).map((e) => ({ name: e.name, lowPerSf: e.low as number, highPerSf: e.high as number }));
  lastChecks = checkExpenses(op, state.expenses, rr.units, rr.sf, benchmarks);
  rentGrid.refresh();
  expGrid.refresh();
  compGridH.refresh();

  $('scenario-blurb').textContent = state.blurb;

  $('rent-summary').innerHTML = kv([
    ['Units / square feet', `${int(rr.units)} / ${int(rr.sf)}`],
    ['Physical occupancy', pct(rr.physicalOccupancy, 0), `${rr.occupiedUnits} of ${rr.units} units`],
    ['Scheduled rent (in-place, market for vacant)', usd(rr.scheduledAnnual)],
    ['Market rent, every unit', usd(rr.marketAnnual)],
    ['Market minus scheduled', usd(rr.mtm), rr.mtm > 0 ? 'in-place rents sit below market' : rr.mtm < 0 ? 'in-place rents sit above market' : ''],
    ['Potential gross income used', usd(pgi)],
  ]);

  const lines: [string, number, boolean?][] = [
    ['Potential gross income', op.pgi],
    [`Less vacancy (${pct(state.vacancyPct, 1)})`, -op.vacancyLoss],
    [`Less credit loss (${pct(state.creditLossPct, 1)})`, -op.creditLoss],
    [`Plus other income`, op.otherIncome],
    ['Effective gross income', op.egi, true],
    ['Less operating expenses', -op.expenseTotal],
    ['Net operating income', op.noi, true],
  ];
  const rrSf = rr.sf || 1;
  $('statement').innerHTML =
    '<table class="plain"><tbody>' +
    lines.map(([k, v, bold]) => `<tr class="${bold ? 'total' : ''}"><td>${esc(k)}</td><td class="r num">${usd(v)}</td><td class="r num dim">${usd2(v / rrSf)}/sf</td><td class="r num dim">${op.egi > 0 ? pct(v / op.egi, 1) : ''}</td></tr>`).join('') +
    '</tbody></table>' +
    `<p class="note">Expense ratio ${pct(op.egi > 0 ? op.expenseTotal / op.egi : NaN, 1)} of EGI. NOI per unit ${usd(rr.units ? op.noi / rr.units : NaN)}, per sf ${usd2(op.noi / rrSf)}.</p>`;

  // Cap rates
  const capStats = stats(state.comps.map(compCapRate));
  const grmStats = stats(state.comps.map(compGrm));
  $('comp-stats').innerHTML = kv([
    ['Cap rate, median', pct(capStats.median), `mean ${pct(capStats.mean)}, range ${pct(capStats.min)} to ${pct(capStats.max)}, n = ${capStats.n}`],
  ]);
  const band = bandOfInvestment(safeBand());
  const dcrCap = (() => {
    try {
      return dcrCapRate(state.dcr, Math.min(1, Math.max(0, state.band.ltv)), state.band.rate, Math.max(1, state.band.years));
    } catch {
      return NaN;
    }
  })();
  $('band-out').innerHTML = kv([
    ['Mortgage constant', pct(band.mortgageConstant, 4), 'annual debt service per $1 of loan'],
    ['Mortgage component', pct(band.mortgageComponent, 3), `${pct(state.band.ltv, 0)} x ${pct(band.mortgageConstant, 3)}`],
    ['Equity component', pct(band.equityComponent, 3), `${pct(1 - state.band.ltv, 0)} x ${pct(state.band.equityDividend, 3)}`],
    ['Overall cap rate (band)', pct(band.capRate), ''],
    ['Cap rate by debt coverage method', pct(dcrCap), `${state.dcr}x coverage x ${pct(state.band.ltv, 0)} loan x ${pct(band.mortgageConstant, 3)} constant`],
  ]);

  const guard = (fn: () => number): number => {
    try {
      return fn();
    } catch {
      return NaN;
    }
  };
  const directValue = guard(() => directCap(op.noi, state.selectedCap));
  const loan = directValue * state.band.ltv;
  const dscr = loan > 0 ? op.noi / (loan * band.mortgageConstant) : NaN;
  $('direct-out').innerHTML = kv([
    ['NOI', usd(op.noi)],
    ['Selected cap rate', pct(state.selectedCap)],
    ['Value by direct capitalization', usd(directValue), `NOI divided by cap rate`],
    ['Debt service coverage at that value', Number.isFinite(dscr) ? dscr.toFixed(2) + 'x' : 'n/a', `${pct(state.band.ltv, 0)} loan, lenders often want 1.20x or more`],
  ]);

  const grmV = grmValue(state.selectedGrm, pgi);
  $('grm-out').innerHTML = kv([
    ['Comp GRM, median', mult(grmStats.median), `range ${mult(grmStats.min)} to ${mult(grmStats.max)}, n = ${grmStats.n}`],
    ['Annual gross rent used', usd(pgi)],
    ['Value by GRM', usd(grmV), `${state.selectedGrm} x gross rent`],
  ]);

  // DCF
  const dcfBase = {
    years: state.dcf.years,
    pgi,
    otherIncome: state.otherIncome,
    vacancyPct: state.vacancyPct,
    creditLossPct: state.creditLossPct,
    expenses: state.expenses,
    rentGrowth: state.dcf.rentGrowth,
    expenseGrowth: state.dcf.expenseGrowth,
    reservePerSf: state.dcf.reservePerSf,
    sf: rr.sf,
    terminalCap: state.dcf.terminalCap,
    sellingCostPct: state.dcf.sellingCostPct,
    discountRate: state.dcf.discountRate,
  };
  const dcf = (() => {
    try {
      return runDcf({ ...dcfBase, price: state.dcfPrice ?? (Number.isFinite(directValue) ? directValue : undefined) });
    } catch {
      return null;
    }
  })();
  if (dcf) {
    const d = dcf;
    $('dcf-table').innerHTML =
      '<table class="plain"><thead><tr><th>Year</th><th class="r">PGI</th><th class="r">EGI</th><th class="r">Expenses</th><th class="r">NOI</th><th class="r">Reserve</th><th class="r">Cash flow</th></tr></thead><tbody>' +
      d.rows.map((r) => `<tr><td>${r.year}</td><td class="r num">${usd(r.pgi)}</td><td class="r num">${usd(r.egi)}</td><td class="r num">${usd(r.expenses)}</td><td class="r num">${usd(r.noi)}</td><td class="r num">${usd(r.reserve)}</td><td class="r num">${usd(r.cashFlow)}</td></tr>`).join('') +
      '</tbody></table>';
    $('dcf-out').innerHTML = kv([
      [`Year ${state.dcf.years + 1} NOI`, usd(d.forwardNoi)],
      ['Sale price at terminal cap', usd(d.grossReversion)],
      ['Net of selling costs', usd(d.netReversion)],
      ['PV of cash flows', usd(d.pvCashFlows)],
      ['PV of reversion', usd(d.pvReversion), `${pct(d.presentValue > 0 ? d.pvReversion / d.presentValue : NaN, 0)} of value`],
      ['DCF value (at the discount rate)', usd(d.presentValue)],
      ['Price used for IRR', usd(d.price), state.dcfPrice === null ? 'direct cap value' : 'entered'],
      ['Unlevered IRR at that price', pct(d.irr), `vs discount rate ${pct(state.dcf.discountRate)}`],
      ['NPV at the discount rate', usd(d.npv), 'DCF value minus price'],
    ]);
  } else {
    $('dcf-table').innerHTML = '<p class="msg">Check the DCF inputs (terminal cap rate must be above 0).</p>';
    $('dcf-out').innerHTML = '';
  }
  const dcfValue = dcf?.presentValue ?? NaN;

  // Sensitivity
  const capsAxis = [-2, -1, 0, 1, 2].map((k) => Math.max(0.005, state.selectedCap + k * state.sensitivityCapStep));
  const vacAxis = [-2, -1, 0, 1, 2].map((k) => Math.max(0, state.vacancyPct + k * state.sensitivityVacStep));
  const grid5 = sensitivity(income, capsAxis, vacAxis);
  const flat = grid5.values.flat();
  const lo = Math.min(...flat);
  const hi = Math.max(...flat);
  $('sens-table').innerHTML =
    '<table class="plain sens"><thead><tr><th>Vacancy \\ Cap rate</th>' +
    capsAxis.map((c) => `<th class="r">${pct(c)}</th>`).join('') +
    '</tr></thead><tbody>' +
    grid5.values
      .map((row, vi) => `<tr><th class="rowh">${pct(vacAxis[vi] as number, 1)}</th>${row.map((v, ci) => `<td class="r num heat${vi === 2 && ci === 2 ? ' base' : ''}" style="--t:${hi > lo ? ((v - lo) / (hi - lo)).toFixed(3) : 0.5}">${usd(roundTo(v, 1000))}</td>`).join('')}</tr>`)
      .join('') +
    '</tbody></table><p class="note">Values rounded to the nearest $1,000. Outlined cell is the current selection.</p>';

  // Reconciliation
  const w = state.weights;
  const ind = [
    { name: 'Direct capitalization', value: directValue, weight: w.direct },
    { name: 'Gross rent multiplier', value: grmV, weight: w.grm },
    { name: 'Discounted cash flow', value: dcfValue, weight: w.dcf },
  ];
  const rec = reconcile(ind);
  const maxV = Math.max(...ind.map((x) => (Number.isFinite(x.value) ? x.value : 0)), 1);
  $('rec-table').innerHTML =
    '<table class="plain"><thead><tr><th>Indication</th><th class="r">Value</th><th class="r">Per unit</th><th class="r">Per sf</th><th class="r">Weight</th><th class="r">Share</th><th class="barcol"></th></tr></thead><tbody>' +
    ind
      .map(
        (x, i) =>
          `<tr><td>${esc(x.name)}</td><td class="r num">${usd(x.value)}</td><td class="r num">${usd(x.value / (rr.units || 1))}</td><td class="r num">${usd2(x.value / rrSf)}</td>` +
          `<td class="r"><input class="wt" type="number" min="0" step="5" data-w="${i}" value="${x.weight}" aria-label="Weight for ${esc(x.name)}"></td>` +
          `<td class="r num">${pct(rec.weights[i] ?? 0, 0)}</td><td class="barcol"><span class="vbar" style="width:${Math.max(0, ((Number.isFinite(x.value) ? x.value : 0) / maxV) * 100).toFixed(1)}%"></span></td></tr>`,
      )
      .join('') +
    '</tbody></table>';
  document.querySelectorAll<HTMLInputElement>('input[data-w]').forEach((el) => {
    el.addEventListener('change', () => {
      const k = Number(el.dataset.w);
      const v = Math.max(0, Number(el.value) || 0);
      if (k === 0) w.direct = v;
      else if (k === 1) w.grm = v;
      else w.dcf = v;
      update();
    });
  });
  const rounded = roundTo(rec.value, 1000);
  $('rec-out').innerHTML = kv([
    ['Weighted indication', usd(rec.value)],
    ['Rounded to nearest $1,000', usd(rounded), 'illustration only, not an appraised value'],
    ['Range of indications', `${usd(rec.low)} to ${usd(rec.high)}`, `spread ${pct(rec.spreadPct, 1)} of the weighted value`],
    ['Per unit / per sf', `${usd(rec.value / (rr.units || 1))} / ${usd2(rec.value / rrSf)}`],
    ['Implied cap rate on NOI', pct(op.noi / rec.value)],
  ]);

  // Stabilized to as-is
  const lul = leaseUpLoss(state.units, state.leaseUpMonths);
  const asIs = asIsValue(rounded, lul, state.adjustments);
  $('asis-out').innerHTML = kv([
    ['Stabilized value (rounded indication)', usd(rounded)],
    [`Less lease-up rent loss (${int(state.units.filter((u) => !u.occupied).length)} vacant, ${state.leaseUpMonths} months)`, usd(-lul), 'market rent of vacant units x months'],
    ...state.adjustments.map((a): [string, string] => [`Less ${a.name}`, usd(-a.amount)]),
    ['As-is value', usd(asIs), 'illustration only, not an appraised value'],
  ]);
  lastRows = [
    ['property', 'scenario', state.name],
    ['rent roll', 'units', rr.units],
    ['rent roll', 'square feet', rr.sf],
    ['rent roll', 'potential gross income', pgi],
    ['operating', 'effective gross income', op.egi],
    ['operating', 'operating expenses', op.expenseTotal],
    ['operating', 'net operating income', op.noi],
    ['cap rate', 'selected', state.selectedCap],
    ['cap rate', 'comp median', capStats.median],
    ['cap rate', 'band of investment', band.capRate],
    ['cap rate', 'debt coverage method', dcrCap],
    ['value', 'direct capitalization', directValue],
    ['value', 'gross rent multiplier', grmV],
    ['value', 'discounted cash flow', dcfValue],
    ['value', 'weighted indication', rec.value],
    ['value', 'rounded indication', rounded],
    ['value', 'as-is value', asIs],
    ['dcf', 'unlevered IRR at price', dcf?.irr ?? NaN],
  ];

  // Checks
  const msgs: string[] = [];
  if (Math.abs(capStats.median - state.selectedCap) > 0.01) msgs.push(`Selected cap rate ${pct(state.selectedCap)} is more than 1.00 point from the comp median ${pct(capStats.median)}. Support the choice.`);
  if (Math.abs(band.capRate - state.selectedCap) > 0.01) msgs.push(`Band of investment cap rate ${pct(band.capRate)} differs from the selected rate by more than 1.00 point.`);
  lastChecks.filter((c) => c.flag === 'high' || c.flag === 'low').forEach((c) => msgs.push(`${c.name} is ${c.flag === 'high' ? 'above' : 'below'} the benchmark range (${usd2(c.perSf)} per sf).`));
  if (rec.spreadPct > 0.15) msgs.push(`Indications differ by ${pct(rec.spreadPct, 0)} of the weighted value. Re-check inputs before leaning on the weights.`);
  if (state.dcf.terminalCap < state.selectedCap) msgs.push('Terminal cap rate is below the going-in cap rate. Terminal rates are usually at or above going-in rates.');
  if (rr.mtm > 0 && state.basis === 'market') msgs.push(`In-place rents are about ${usd(rr.mtm)} a year below market. Market-rent PGI assumes leases roll up to market.`);
  if (state.vacancyPct < 1 - rr.physicalOccupancy && state.basis === 'contract') msgs.push('Stabilized vacancy is below current physical vacancy.');
  $('checks').innerHTML = msgs.length ? '<h3>Checks</h3><ul class="checks">' + msgs.map((m) => `<li>${esc(m)}</li>`).join('') + '</ul>' : '<p class="note">No warnings from the built-in checks.</p>';

  // Summary tiles
  $('tiles').innerHTML = [
    ['Reconciled indication', usd(rounded), 'solid'],
    ['Net operating income', usd(op.noi), ''],
    ['Selected cap rate', pct(state.selectedCap), ''],
    ['Per unit', usd(rec.value / (rr.units || 1)), ''],
  ]
    .map(([l, v, c]) => `<div class="tile card ${c}"><span class="lbl">${l}</span><span class="big num">${v}</span></div>`)
    .join('');

  lastMedians = { cap: capStats.median, grm: grmStats.median, band: band.capRate, dcr: dcrCap };
}

let lastRows: [string, string, number | string][] = [];
let lastMedians = { cap: NaN, grm: NaN, band: NaN, dcr: NaN };

function safeBand() {
  const b = state.band;
  return { ltv: Math.min(1, Math.max(0, b.ltv)), rate: b.rate, years: Math.max(1, b.years), equityDividend: b.equityDividend };
}

/* ---------- actions ---------- */

function loadScenario(id: string): void {
  const s = scenarios.find((x) => x.id === id);
  if (!s) return;
  state = load(s);
  $('csv-msg').textContent = '';
  mountGrids();
  syncInputs();
  update();
}

function init(): void {
  const sel = $<HTMLSelectElement>('scenario');
  sel.innerHTML = scenarios.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  sel.addEventListener('change', () => loadScenario(sel.value));
  bindInputs();

  $('csv-file').addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const { units, errors } = parseRentRollCsv(await f.text());
    const msg = $('csv-msg');
    if (units.length) {
      state.units = units;
      mountGrids();
      update();
      msg.textContent = `Loaded ${units.length} units from ${f.name}.` + (errors.length ? ' Skipped: ' + errors.join(' ') : '');
    } else msg.textContent = errors.join(' ') || 'No rows found.';
    (e.target as HTMLInputElement).value = '';
  });

  const download = (name: string, text: string, type: string): void => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $('save-json').addEventListener('click', () => download('income-approach-scenario.json', toJson(state), 'application/json'));
  $('export-csv').addEventListener('click', () => download('income-approach-summary.csv', summaryCsv(lastRows), 'text/csv'));
  $('print').addEventListener('click', () => window.print());
  $('load-json').addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const { scenario, error } = fromJson(await f.text());
    const msg = $('csv-msg');
    if (scenario) {
      state = load(scenario);
      mountGrids();
      syncInputs();
      update();
      msg.textContent = `Loaded scenario from ${f.name}.`;
    } else msg.textContent = error ?? 'Could not load file.';
    (e.target as HTMLInputElement).value = '';
  });
  $('use-dcr-cap').addEventListener('click', () => setCap(lastMedians.dcr));

  $('csv-template').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rentRollTemplate], { type: 'text/csv' }));
    a.download = 'rent-roll-template.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const setCap = (v: number): void => {
    if (!Number.isFinite(v)) return;
    state.selectedCap = Math.round(v * 10000) / 10000;
    syncInputs();
    update();
  };
  $('use-median-cap').addEventListener('click', () => setCap(lastMedians.cap));
  $('use-band-cap').addEventListener('click', () => setCap(lastMedians.band));
  $('use-median-grm').addEventListener('click', () => {
    if (!Number.isFinite(lastMedians.grm)) return;
    state.selectedGrm = Math.round(lastMedians.grm * 100) / 100;
    syncInputs();
    update();
  });

  mountGrids();
  syncInputs();
  update();
}

init();
