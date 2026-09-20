# Трекер целей

Mobile-first habit/goal tracker. Data lives on the device; transfer, backup and
restore all go through a JSON file. No server, no account.

Built from `goal-tracker.html` — the original single-file prototype, kept in the
repo for reference. Its CSS and interaction design carried over essentially
unchanged.

## Develop

```bash
npm install
npm run dev       # http://localhost:5173/goal-tracker/
npm test          # unit + jsdom view tests
npm run build     # typecheck + production build into dist/
npm run preview   # serve dist/ on the real base path
```

`npm run preview` is the one that matches production: it honours the
`/goal-tracker/` base path, which `dev` can mask.

## Deploy (GitHub Pages)

1. Push to GitHub as a repo named **goal-tracker**.
2. Settings → Pages → Source: **GitHub Actions**.
3. Push to `main`. `.github/workflows/deploy.yml` tests, builds and publishes.

The site lives at `https://<user>.github.io/goal-tracker/`.

**The base path matters.** `vite.config.ts` sets `base: '/goal-tracker/'`, and
the manifest `start_url`/`scope` plus the service-worker scope derive from it.
If you rename the repo, use a custom domain, or rename to `<user>.github.io`,
set it accordingly:

```bash
BASE_PATH=/ npm run build
```

Get this wrong and the service worker registers at the wrong scope: the app
still loads, but silently never works offline.

## How the data works

State is `{ goals, marks }`. A mark is keyed `"goalId|YYYY-MM-DD"` and its value
is a **signed timestamp** — `+t` marked at `t`, `-t` unmarked at `t`.

That one number is what makes device-to-device transfer real rather than a
destructive overwrite: merging two files compares magnitudes per key, so an
unmark on one device is not resurrected by an older mark on the other. The merge
is commutative, so a two-device round trip converges. See `src/backup/merge.ts`
and the round-trip test in `test/merge.test.ts`.

Goal **order is derived, never stored**: all-time mark count descending, ties by
creation order. A stored order field would be a third thing merge has to
reconcile, with no correct answer when two devices reorder independently.

### Durability

Data is client-only, so three things guard it:

- **IndexedDB** is primary, with `navigator.storage.persist()` requested on
  first run.
- **A synchronous `localStorage` mirror** is written on `pagehide` /
  `visibilitychange`. IndexedDB writes are async and may not land while a page is
  being torn down, so a mark toggled immediately before closing the tab would
  otherwise be lost. Boot takes whichever copy is newer.
- **Restore points** (last 3) are written before every import, because "Replace
  everything" sits one tap from "Merge".

iOS Safari evicts script-writable storage after ~7 days without a visit and
exempts Home-Screen apps — which is why the app is installable and nudges you to
install it. Backups are still the real safety net.

## Importing from another tool

See [docs/import-format.md](docs/import-format.md). The short version:

```json
{ "goals": [ { "name": "Спорт", "dates": ["2026-09-01", "2026-09-03"] } ] }
```

A lenient adapter also accepts common field-name variations. Add a
source-specific adapter in `src/import/adapters/` if needed — the preview and
merge path is shared.

## Layout

```
src/
  lib/        date, Russian strings, DOM helpers
  state/      schema + migrations, store (mutations, derived order)
  storage/    IndexedDB, synchronous mirror
  stats/      month window and per-month maths
  views/      week, stats, goal sheet, settings, toast
  backup/     export, import, merge
  import/     canonical format + source adapters
  dev/        demo data generator
tools/        icon generator (node tools/make-icons.mjs)
```
