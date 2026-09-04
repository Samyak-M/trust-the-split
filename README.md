# Trust the Split — Shared Project Finance Tracker

A lightweight expense-splitting app for groups running a project (a food stall, a trip, a puja). It models **money movement**, not a spreadsheet:

1. **Deposit** — person A pays into the common pot; person B (or several people) hold it.
2. **Expense** — one or more people pay a shop; the cost is shared with a rule on *that* expense only. Funding is either the **common fund** or **pocket**.
3. **Settlement** — person A actually pays person B back. This does not rewrite deposits or expenses.

The dashboard answers: who deposited what, who is holding common cash, who paid each bill, how each bill is shared, who should ultimately bear what, who pays whom, and what is still outstanding.

![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)

## Features

- Multi-project books (Bongo Mela, Goa Trip, …) with their own people
- Multi-payer deposits and expenses (payer amounts must sum to the total)
- Per-expense sharing: equal, unequal ₹, percentages, or head-count weights (e.g. 2 : 3 : 1)
- Common cash holdings derived from transactions, not assumed to sit with one person
- Splitwise-style “who pays whom” after settlements
- People with history cannot be deleted until those records are moved
- Optional **GitHub Pages + Supabase** so everyone edits one copy

## Quick start (this browser only)

```bash
npm install
npm test
npm run dev
```

Or `python3 -m http.server 8000` and open http://localhost:8000

If you already opened an older build, this version uses a new storage key (`stallSplit_v5`). Clear site data if you want the seeded Bongo Mela books instead of a migrated copy.

## Shared online copy (GitHub Pages + Supabase)

Everyone should use one source of truth.

1. **Frontend** — in the GitHub repo: Settings → Pages → Deploy from branch `main` / root. The site is static (`index.html` + `src/` + `styles.css`).
2. **Database** — create a free [Supabase](https://supabase.com) project. In the SQL editor, run `supabase/schema.sql`. Under Database → Replication, enable realtime for `projects`.
3. **Auth** — Authentication → Providers → Email. Add your Pages URL (and `http://localhost:8000`) to Redirect URLs.
4. **Connect the app** — open **Sharing & login**, paste the project URL and the **anon public** key (Project Settings → API). Sign in with a magic link. Invite the others by email.

Until someone signs in, data stays in `localStorage` on that device.

## Bongo Mela seed

Participants: Sunanda, Mantu di, Payel Sarkar.

Seeded deposits (not expenses): each of the three paid ₹5,000 held by Payel (₹15,000 common advance). Groceries ₹9,525 are paid from that common fund by Payel, split equally. Other source-sheet lines are included as pocket expenses with equal sharing so you can edit payer/share/funding to match what actually happened.

The sheet snapshot ₹1,873 / −₹997 / −₹876 is shown on the dashboard **for reconciliation only**. The app will not force those numbers if the underlying rows do not support them.

## Money rules

| Movement | Effect |
| --- | --- |
| Deposit | Increases *deposited* for payers; increases *common cash held* for holders |
| Common-fund expense | Reduces the payer’s holdings; allocates *should bear* via the expense’s share rule. Does **not** count as pocket spending |
| Pocket expense | Increases *pocket paid*; does **not** touch the common pot |
| Cash move | Only changes who is holding common cash |
| Settlement | Changes outstanding “who pays whom” only |

Net = deposited + pocket paid − should bear + settlements paid − settlements received.

## Development

```bash
npm test          # accounting checks
npm run dev       # http://localhost:8000
```

- `src/core.js` — pure calculations and validation
- `src/store.js` — localStorage + Bongo Mela seed
- `src/remote.js` — optional Supabase sync and auth
- `src/main.js` — UI

In the browser console: `window.db` and `window.render()`.

## License

Apache License 2.0 — see LICENSE.

## Author

Samyak Mukherjee — [mukherjeesamyak88@gmail.com](mailto:mukherjeesamyak88@gmail.com)
