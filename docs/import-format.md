# Import format

The app imports two kinds of JSON file. Both go through the same pipeline:
**parse → validate → preview → merge**, so nothing is written until you confirm.

## 1. Backup files (produced by the app)

Настройки → «Сохранить файл» writes `goal-tracker-YYYY-MM-DD.json`:

```json
{
  "format": "goal-tracker.backup",
  "version": 1,
  "exportedAt": 1758326400000,
  "deviceId": "a7f3k2m9x1qp",
  "data": {
    "goals": [
      { "id": "a7f3k2m9x1qp", "name": "Спорт", "created": "2026-01",
        "createdAt": 1767225600000, "updatedAt": 1767225600000 }
    ],
    "marks": { "a7f3k2m9x1qp|2026-01-05": 1767625200000 }
  }
}
```

A mark value is a **signed timestamp**: `+t` means marked at `t`, `-t` means
unmarked at `t`. That single number is what lets two devices merge without
either one losing an edit — see `src/backup/merge.ts`.

## 2. External source files (importing initial data)

This is the contract to target when exporting from another tool. The minimum is
a goal name and a list of dates:

```json
{
  "goals": [
    { "name": "Спорт и здоровье", "dates": ["2026-09-01", "2026-09-03"] },
    { "name": "Чтение",           "dates": ["2026-09-02"] }
  ]
}
```

| Field     | Required | Notes                                                        |
|-----------|----------|--------------------------------------------------------------|
| `name`    | yes      | Trimmed, truncated to 60 characters                          |
| `dates`   | yes      | `"YYYY-MM-DD"`; invalid dates are skipped and reported        |
| `id`      | no       | Supply a stable id to make re-importing the same file a no-op |
| `created` | no       | `"YYYY-MM"`; otherwise inferred from the earliest date        |

### Tolerated variations

If the source shape differs, the lenient adapter
(`src/import/adapters/index.ts`) still recognises it:

- **Goal list** under `goals`, `items`, `habits`, `activities`, `data`, or a
  bare top-level array.
- **Name** as `name`, `title`, `label`, `goal`, `habit`, or `activity`.
- **Dates** as `dates`, `marks`, `days`, `entries`, `completions`, `log`,
  `history`, or `checkins`.
- **Date entries** as plain strings, as objects (`{date}`, `{day}`, `{on}`,
  `{at}`, `{timestamp}`), or as a map `{"2026-09-01": true}` where falsy values
  are skipped.
- **Full ISO timestamps** (`2026-09-01T08:30:00Z`) — the date part is kept.

If nothing matches, the import is refused with an explanation rather than
guessing.

### How imported marks are timestamped

An imported mark is stamped at **noon on the day it records**, not at import
time. Two consequences, both deliberate:

1. Seeded history can never overwrite an edit you already made on this device.
2. Importing the same file on two devices produces identical data, so merging
   them afterwards is a no-op.

## Merge vs Replace

| | Merge (default) | Replace |
|---|---|---|
| Existing goals | kept | discarded |
| Conflicting marks | the later change wins | file wins |
| Reversible | yes, via the undo toast | yes, via Точки восстановления |

A restore point is written before either mode.

## Adding a source-specific adapter

Implement `detect` / `toCanonical` and add it to `ADAPTERS` in
`src/import/adapters/index.ts`; it is ordered before `genericAdapter`. Nothing
else changes — the preview and merge path is shared.
