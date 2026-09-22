/**
 * Converts a saved month page from the external tracker (the `table.cal` grid)
 * into the external-import JSON documented in docs/import-format.md.
 *
 *   node tools/import-from-html.mjs Aug-2026.html [more-months.html …] [-o out.json]
 *                                  [--against backup.json]
 *
 * Several pages merge into one file: a goal is keyed by its `data-tag`, which is
 * stable across months, so dates from every page land on the same goal and
 * re-importing the result is a no-op. Reads stdin when no file is given.
 *
 * The app merges goals by id alone, so an imported goal whose id is unknown
 * arrives as a *new* goal even if a goal of that name already exists. Pass
 * `--against` a backup to re-key rows onto the ids they already have there.
 *
 * Shape of one row in the source:
 *
 *   <tr>
 *     <td><div class="task …" data-tag="698d…">  Спорт и здоровье  </div></td>
 *     <td class="cald"><div class="… con c0" data-on="1" data-tag="698d…" data-j="2"></div></td>
 *     …one cell per day of the month, data-on="1" when done…
 *   </tr>
 */
import { readFileSync, writeFileSync } from 'node:fs';

/* ---------- html helpers ---------- */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const decode = (s) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, e) => ENTITIES[e]);

/** Text of a fragment. Safe here because every `>` inside an attribute value in
 *  the source is entity-encoded, so a tag never contains a bare `>`. */
const text = (html) => decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : null;
};

/* ---------- parsing ---------- */

/** `<span id="month" data-n="8" data-y="2026">`, or the hidden form fields. */
function parseMonth(html, warn) {
  const span = html.match(/<span\b[^>]*\bid="month"[^>]*>/i);
  let n = span && attr(span[0], 'data-n');
  let y = span && attr(span[0], 'data-y');
  if (!n || !y) {
    n = (html.match(/<input\b[^>]*\bname="n"[^>]*\bvalue="(\d+)"/i) ?? [])[1] ?? null;
    y = (html.match(/<input\b[^>]*\bname="y"[^>]*\bvalue="(\d+)"/i) ?? [])[1] ?? null;
  }
  const month = Number(n), year = Number(y);
  if (!(month >= 1 && month <= 12) || !(year >= 1970 && year <= 9999)) {
    throw new Error('не найден месяц страницы (<span id="month" data-n data-y>)');
  }
  if (!span) warn('месяц взят из полей формы, а не из <span id="month">');
  return { year, month };
}

const daysInMonth = (year, month) => new Date(year, month, 0).getDate();
const dateKey = (year, month, day) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/**
 * One page -> [{ id, name, month, dates }]. `month` is the page's own month, so
 * a goal that appears with no marks still gets a truthful `created`.
 */
export function parsePage(html, warn = () => {}) {
  const { year, month } = parseMonth(html, warn);
  const body = (html.match(/<tbody[^>]*>([\s\S]*)<\/tbody>/i) ?? [null, html])[1];
  const last = daysInMonth(year, month);
  const rows = [];

  for (const row of body.split(/<tr\b/i).slice(1)) {
    const head = row.match(/<td\b[^>]*>([\s\S]*?)<\/td>/i);
    if (!head) continue;
    const task = head[1].match(/<div\b[^>]*\bclass="task\b[^>]*>/i);
    if (!task) continue; // the trailing "add activity" / score row
    const id = attr(task[0], 'data-tag');
    const name = text(head[1]);
    if (!id || !name) { warn(`строка без ${id ? 'названия' : 'data-tag'} пропущена`); continue; }

    const dates = [];
    for (const [tag] of row.matchAll(/<div\b[^>]*>/gi)) {
      const day = attr(tag, 'data-j');
      if (day === null) continue;
      const cellId = attr(tag, 'data-tag');
      if (cellId && cellId !== id) { warn(`«${name}»: клетка чужой цели ${cellId} пропущена`); continue; }
      const d = Number(day);
      if (!(d >= 1 && d <= last)) { warn(`«${name}»: день ${day} вне ${year}-${month}`); continue; }
      if (attr(tag, 'data-on') !== '1') continue;
      dates.push(dateKey(year, month, d));
    }
    rows.push({ id, name, month: dateKey(year, month, 1).slice(0, 7), dates });
  }

  if (!rows.length) warn('на странице не найдено ни одной активности');
  return rows;
}

/** Merge pages into the canonical import file, one goal per data-tag. */
export function toImport(pages, warn = () => {}) {
  const byId = new Map();
  for (const row of pages.flat()) {
    const g = byId.get(row.id) ?? { id: row.id, name: row.name, created: row.month, dates: new Set() };
    if (g.name !== row.name) warn(`цель ${row.id} названа и «${g.name}», и «${row.name}» — взято первое`);
    if (row.month < g.created) g.created = row.month;
    for (const d of row.dates) g.dates.add(d);
    byId.set(row.id, g);
  }
  return {
    goals: [...byId.values()].map((g) => ({
      id: g.id,
      name: g.name,
      created: g.created,
      dates: [...g.dates].sort(),
    })),
  };
}

/* ---------- matching against existing goals ---------- */

/** Matching key: exact name, ignoring case, outer space and repeated spaces.
 *  Deliberately nothing fuzzier — «Чтение» must not capture «Развитие через
 *  чтение», and a wrong match silently welds two histories together. */
export const nameKey = (s) => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

/** Index an app backup (or a bare exported state) by name -> {id, name}.
 *  A name carried by two live goals is ambiguous and is left out entirely. */
export function indexByName(json, warn = () => {}) {
  const goals = json?.data?.goals ?? json?.goals;
  if (!Array.isArray(goals)) throw new Error('в файле нет goals[] — ожидался бэкап приложения');
  const byName = new Map();
  const ambiguous = new Set();
  for (const g of goals) {
    if (!g || typeof g.id !== 'string' || typeof g.name !== 'string') continue;
    if (g.deletedAt !== undefined) continue; // tombstone: reusing its id would undelete it
    const k = nameKey(g.name);
    if (!k) continue;
    if (byName.has(k)) { ambiguous.add(k); warn(`в приложении две цели «${g.name}» — сопоставление пропущено`); }
    else byName.set(k, { id: g.id, name: g.name });
  }
  for (const k of ambiguous) byName.delete(k);
  return byName;
}

/**
 * Re-key parsed goals onto existing ids, in place. Unmatched rows keep their
 * `data-tag` and will arrive as new goals — reported, never guessed at.
 */
export function resolveIds(result, byName, warn = () => {}) {
  const claimed = new Map(); // existing id -> the row that took it
  const report = [];
  for (const g of result.goals) {
    const hit = byName.get(nameKey(g.name));
    if (!hit) { report.push({ name: g.name, id: g.id, matched: false }); continue; }
    if (claimed.has(hit.id)) {
      warn(`«${g.name}» и «${claimed.get(hit.id)}» ведут на одну цель приложения — оставлен исходный id`);
      report.push({ name: g.name, id: g.id, matched: false });
      continue;
    }
    claimed.set(hit.id, g.name);
    g.id = hit.id;
    report.push({ name: g.name, id: hit.id, matched: true });
  }
  return report;
}

/* ---------- cli ---------- */

function main(argv) {
  const files = [];
  let out = null, against = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--out') out = argv[++i];
    else if (a.startsWith('--out=')) out = a.slice(6);
    else if (a === '-a' || a === '--against') against = argv[++i];
    else if (a.startsWith('--against=')) against = a.slice(10);
    else if (a === '-h' || a === '--help') { usage(); return; }
    else files.push(a);
  }

  const warnings = [];
  const warn = (m) => warnings.push(m);
  const sources = files.length ? files : ['-'];
  const pages = sources.map((f) => {
    const html = readFileSync(f === '-' ? 0 : f, 'utf8');
    const rows = parsePage(html, (m) => warn(`${f}: ${m}`));
    console.error(`${f}: активностей ${rows.length}, отметок ${rows.reduce((n, r) => n + r.dates.length, 0)}`);
    return rows;
  });

  const result = toImport(pages, warn);

  if (against) {
    const byName = indexByName(JSON.parse(readFileSync(against, 'utf8')), (m) => warn(`${against}: ${m}`));
    const report = resolveIds(result, byName, warn);
    console.error(`${against}: целей в приложении ${byName.size}`);
    for (const r of report) {
      console.error(r.matched ? `  = «${r.name}» -> ${r.id}` : `  + «${r.name}» — новая цель`);
    }
  }

  const json = JSON.stringify(result, null, 2) + '\n';
  if (out) writeFileSync(out, json); else process.stdout.write(json);

  const marks = result.goals.reduce((n, g) => n + g.dates.length, 0);
  console.error(`итого: целей ${result.goals.length}, отметок ${marks}${out ? ` -> ${out}` : ''}`);
  for (const w of warnings) console.error(`! ${w}`);
}

function usage() {
  console.error('node tools/import-from-html.mjs <page.html…> [-o out.json] [--against backup.json]');
  console.error('  --against  бэкап приложения: цели с тем же названием получат его id');
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`ошибка: ${e.message}`);
    process.exit(1);
  }
}
