export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const usd = (v: number): string => (Number.isFinite(v) ? (v < 0 ? '-$' : '$') + nf0.format(Math.abs(v)) : 'n/a');
export const usd2 = (v: number): string => (Number.isFinite(v) ? (v < 0 ? '-$' : '$') + nf2.format(Math.abs(v)) : 'n/a');
export const pct = (v: number, d = 2): string => (Number.isFinite(v) ? (v * 100).toFixed(d) + '%' : 'n/a');
export const mult = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) + 'x' : 'n/a');
export const int = (v: number): string => (Number.isFinite(v) ? nf0.format(v) : 'n/a');

/** Decimal to the text shown in a percent box: 0.0675 -> "6.75". */
export const toPctText = (v: number): string => String(Number((v * 100).toFixed(4)));

export interface Col<T> {
  label: string;
  key?: keyof T & string;
  kind?: 'text' | 'num' | 'pct' | 'bool';
  optional?: boolean;
  calc?: (row: T, index: number) => string;
  /** Optional class for a calc cell. */
  cls?: (row: T, index: number) => string;
  align?: 'right';
}

export interface Grid {
  refresh(): void;
}

interface GridOptions<T> {
  newRow: () => T;
  addLabel: string;
}

/** Editable table. Mutates `rows` in place and calls onChange after each edit. */
export function grid<T extends object>(host: HTMLElement, cols: Col<T>[], rows: T[], onChange: () => void, opts: GridOptions<T>): Grid {
  host.textContent = '';
  const table = document.createElement('table');
  const thead = table.createTHead();
  const hr = thead.insertRow();
  cols.forEach((c) => {
    const th = document.createElement('th');
    th.textContent = c.label;
    if (c.align === 'right' || c.kind === 'num' || c.kind === 'pct' || c.calc) th.className = 'r';
    hr.appendChild(th);
  });
  hr.appendChild(document.createElement('th'));
  const tbody = table.createTBody();
  const calcCells: { td: HTMLElement; col: Col<T>; row: T; index: number }[] = [];

  const build = (): void => {
    tbody.textContent = '';
    calcCells.length = 0;
    rows.forEach((row, index) => {
      const tr = tbody.insertRow();
      cols.forEach((c) => {
        const td = tr.insertCell();
        if (c.calc) {
          td.className = 'calc r';
          calcCells.push({ td, col: c, row, index });
          return;
        }
        const key = c.key as keyof T;
        const input = document.createElement('input');
        input.setAttribute('aria-label', c.label);
        const value = row[key] as unknown;
        if (c.kind === 'bool') {
          input.type = 'checkbox';
          input.checked = Boolean(value);
          input.addEventListener('change', () => {
            (row as Record<string, unknown>)[key as string] = input.checked;
            onChange();
          });
        } else if (c.kind === 'text') {
          input.type = 'text';
          input.value = String(value ?? '');
          input.addEventListener('input', () => {
            (row as Record<string, unknown>)[key as string] = input.value;
            onChange();
          });
        } else {
          input.type = 'number';
          input.step = 'any';
          input.min = '0';
          input.className = 'r';
          input.value = value === undefined || value === null ? '' : c.kind === 'pct' ? toPctText(value as number) : String(value);
          input.addEventListener('input', () => {
            const raw = input.value.trim();
            const num = Number(raw);
            if (raw === '' && c.optional) delete (row as Record<string, unknown>)[key as string];
            else (row as Record<string, unknown>)[key as string] = raw === '' || !Number.isFinite(num) ? 0 : c.kind === 'pct' ? num / 100 : num;
            onChange();
          });
        }
        td.appendChild(input);
      });
      const del = tbody.rows[index]!.insertCell();
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'x';
      b.textContent = '×';
      b.setAttribute('aria-label', 'Remove row');
      b.addEventListener('click', () => {
        rows.splice(index, 1);
        build();
        onChange();
      });
      del.appendChild(b);
    });
  };
  build();
  host.appendChild(table);

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn small';
  add.textContent = opts.addLabel;
  add.addEventListener('click', () => {
    rows.push(opts.newRow());
    build();
    onChange();
  });
  host.appendChild(add);

  return {
    refresh() {
      calcCells.forEach(({ td, col, row, index }) => {
        td.textContent = col.calc ? col.calc(row, index) : '';
        const extra = col.cls?.(row, index) ?? '';
        td.className = ('calc r ' + extra).trim();
      });
    },
  };
}

export function kv(pairs: [string, string, string?][]): string {
  return pairs
    .map(([k, v, note]) => `<div class="kvrow"><span class="k">${esc(k)}</span><span class="v num">${v}</span>${note ? `<span class="n">${esc(note)}</span>` : ''}</div>`)
    .join('');
}
