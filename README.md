# StallSplit — Shared Project Finance Tracker

A lightweight, modular expense-splitting app for managing shared finances in projects, groups, or businesses (like stalls). Track deposits, expenses, settlements, and automatically calculate who owes whom.

![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)

## Features

- 📊 **Dashboard** — Overview of cash holdings, debt relationships, and participant balances
- 🧾 **Transaction Management** — Log deposits and expenses with flexible sharing modes
- 💸 **Smart Settlements** — Track repayments and update outstanding balances
- 👥 **People Management** — Add/remove project members
- 📁 **Multi-Project Support** — Manage multiple groups/stalls simultaneously
- 🔄 **Automatic Debt Simplification** — Greedy algorithm reduces transactions needed to settle
- 💾 **Local Storage Persistence** — All data stored in browser (no server required)
- 📱 **Responsive Design** — Works on desktop and mobile devices

## Quick Start

### Option 1: Python (built-in on most systems)
```bash
python3 -m http.server 8000
# Open http://localhost:8000 in your browser
```

### Option 2: Node.js + npm
```bash
npm install
npm run dev
# Opens http://localhost:8000 automatically
```

### Option 3: Node.js Simple Server
```bash
npx http-server -p 8000 -o
```

## Usage

1. **Add People** — Go to People tab and add project members
2. **Log Transactions**:
   - **Deposits**: Money added to common fund (e.g., advance payment)
   - **Expenses**: Costs paid from common fund or pocket money
3. **Manage Sharing**:
   - Equal split (each person gets 1/n share)
   - Custom shares (by amount or percentage)
4. **Track Settlements** — Record repayments between people
5. **View Simplifications** — Dashboard shows minimal transactions needed to settle all debts

## Project Structure

```
trust-the-split/
├── index.html          # Main HTML template
├── styles.css          # All styling (single file, responsive)
├── src/
│   ├── core.js         # Pure functions: allocations, balances, settlements
│   ├── store.js        # localStorage persistence + sample data
│   └── main.js         # UI logic and event handlers
├── package.json        # Dev dependencies and scripts
├── LICENSE             # Apache 2.0
└── README.md           # This file
```

## Architecture

### Core Functions (`src/core.js`)

- **`alloc(people, tx)`** — Compute per-person allocation for a transaction
- **`expenseShares(project)`** — Aggregate expense shares per person
- **`balances(project)`** — Calculate net balance per person (who owes/is owed)
- **`simplify(project)`** — Greedy algorithm to reduce settlement transactions
- **`moneyFmt(n)`** — Format rupees for display
- **`nameById(project, id)`** — Look up person name by ID

### Data Structures

**Project:**
```javascript
{
  id: string,
  name: string,
  desc: string,
  people: [{ id, name }],
  transactions: [{ date, type, desc, amount, from, to, source, shareMode, shares }],
  settlements: [{ date, from, to, amount, note }],
  sourceSnapshot: { date, commonBalance, personNet }
}
```

**Transaction Types:**
- `"deposit"` — Money added to common fund (from → to person holding cash)
- `"expense"` — Cost paid (from person who paid, source: "pocket" or "common")

**Share Modes:**
- `"equal"` — Each person gets 1/n
- `"amount"` — Custom amounts per person
- `"share"` — Custom shares (normalized to sum to 1)

### Storage

- **Key:** `stallSplit_v4` (localStorage)
- **Format:** JSON stringified database object
- **Auto-init:** If storage is empty, loads sample "Bongo Mela" project

## Development

### Running Tests

No formal test suite yet. Manual testing checklist:
- [ ] Add/edit/delete people
- [ ] Log different transaction types
- [ ] Toggle sharing modes
- [ ] Verify balance calculations match expected
- [ ] Record settlements and confirm they update balances
- [ ] Switch between projects
- [ ] Hard refresh browser and verify data persists

### Browser Console Helpers

In the dev console:
```javascript
// Inspect current state
window.db

// Force re-render
window.render()

// Clear all data
localStorage.removeItem('stallSplit_v4')
```

## Known Limitations

- No backend sync (single browser only)
- No authentication or multi-user editing
- No data export (can copy JSON from console)
- No undo/redo (refresh page to see last persisted state)
- All data in one localStorage key (browser/device specific)

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make changes and test in browser
4. Commit with clear messages
5. Push and open a PR

**Guidelines:**
- Keep UI and core logic separated
- `core.js` functions must be pure (no side effects)
- Test edge cases (empty lists, zero amounts, rounding)
- Keep styles in `styles.css` (no inline styles)

## License

Apache License 2.0 — See LICENSE file for details

## Author

Samyak Mukherjee — [mukherjeesamyak88@gmail.com](mailto:mukherjeesamyak88@gmail.com)

## Support

For issues, questions, or suggestions, open a GitHub issue or contact the author.
