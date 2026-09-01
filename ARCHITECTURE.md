# Architecture Overview

## Philosophy

**Separation of Concerns**

Trust the Split follows a clear three-layer architecture:

1. **Core Logic** (`src/core.js`) — Pure functions, no I/O
2. **State Management** (`src/store.js`) — Persistence layer
3. **UI & Orchestration** (`src/main.js`) — Events and rendering

This keeps the business logic testable and portable.

## Core Layer (`src/core.js`)

### Public Functions

#### Allocation & Shares
```javascript
alloc(people, tx) → { [personId]: share }
```
Returns normalized allocation map for a transaction. Handles:
- **Equal split** — Each person gets 1/n
- **Custom amounts** — Sums are normalized to 1
- **Custom shares** — Pre-normalized ratios

**Example:**
```javascript
alloc([{id: "a"}, {id: "b"}, {id: "c"}], 
  {shareMode: "equal"}) 
// → { a: 0.333..., b: 0.333..., c: 0.333... }
```

#### Aggregations
```javascript
expenseShares(project) → { [personId]: totalAmount }
```
Sum of each person's expense share across all transactions.

```javascript
balances(project) → { [personId]: netAmount }
```
Net position: positive = owed money, negative = owes money.

Calculation:
1. Deposits: add to `to` person, subtract from `from`
2. Expenses: add to payer, subtract each person's share
3. Settlements: adjust balances for recorded repayments

#### Debt Resolution
```javascript
simplify(project) → [{ from, to, amount }]
```
**Algorithm:** Greedy matching
1. Split people into debtors (negative balance) and creditors (positive)
2. Sort both by balance magnitude (largest first)
3. Match debtors to creditors top-down, minimizing transactions

**Why greedy?** O(n log n) instead of NP-hard optimal. Works well for small groups.

**Example:**
```
Balances: { a: -10, b: -5, c: +15 }
→ Debtors: [a(-10), b(-5)]
→ Creditors: [c(+15)]

Match:
1. a owes c 10 → a: 0, c: +5
2. b owes c 5 → b: 0, c: 0

Result: [
  { from: "a", to: "c", amount: 10 },
  { from: "b", to: "c", amount: 5 }
]
```

### Utility Functions

```javascript
moneyFmt(n) → string    // Format as ₹ with 2 decimals
uid() → string          // Generate unique ID
nameById(project, id) → string
shareLabel(tx) → string // Human-readable share mode
```

## State Layer (`src/store.js`)

### Data Model

```javascript
{
  projects: [
    {
      id: string,
      name: string,
      desc: string,
      people: [{ id, name }],
      transactions: [{
        id?: string,
        date: "YYYY-MM-DD",
        type: "deposit" | "expense",
        desc: string,
        amount: number,
        from: personId | "external",
        to: personId,
        source: "pocket" | "common", // only for expense
        shareMode: "equal" | "amount" | "share",
        shares: { [personId]: number }
      }],
      settlements: [{
        id?: string,
        date: "YYYY-MM-DD",
        from: personId,
        to: personId,
        amount: number,
        note?: string
      }],
      sourceSnapshot?: { ... }
    }
  ],
  current: projectId
}
```

### API

```javascript
loadDB() → db
// Load from localStorage or init with sample data

saveDB(db) → void
// Persist to localStorage
```

**Key:** `stallSplit_v4` (persistent across sessions)

## UI Layer (`src/main.js`)

### Architecture

```
main.js
├── State Management
│   ├── Load DB on init
│   ├── Update DB on changes
│   └── Persist on every change
├── Render Functions (per section)
│   ├── renderDashboard()
│   ├── renderTransactions()
│   ├── renderBalances()
│   ├── renderSettlements()
│   ├── renderPeople()
│   └── renderProjects()
├── Modal System
│   ├── Form templates
│   ├── Show/hide + focus management
│   └── Save/cancel handlers
└── Event Delegation
    ├── Navigation (view switching)
    ├── CRUD operations
    └── Project selection
```

### Key Abstractions

**`dom(selector)`** — Get element (with null-safety)

**`render()`** — Full page re-render
- Triggered on any state change
- Re-renders active view only (others hidden)
- Efficient: swaps table bodies, not entire DOM

**`showModal(title, form, save)`** — Modal dialog
- Escape key closes
- Focus trap
- Form validation in save callback

### Event Flow

1. User interaction (click, input)
2. Event handler modifies `db`
3. Handler calls `render()`
4. render() updates active section + UI state

## Data Flow Diagram

```
┌─────────────────────────────────────────────┐
│           Browser (single-page)             │
├─────────────────────────────────────────────┤
│                                             │
│  ┌──────────────┐   ┌─────────────────────┐ │
│  │  UI Layer    │   │  localStorage       │ │
│  │  (main.js)   │◄─►│  (stallSplit_v4)    │ │
│  └──────┬───────┘   └─────────────────────┘ │
│         │                                   │
│         ▼                                   │
│  ┌─────────────────────────────────┐       │
│  │  State: db = {                  │       │
│  │    projects: [...],             │       │
│  │    current: projectId           │       │
│  │  }                              │       │
│  └─────────────────────────────────┘       │
│         │                                   │
│         ▼                                   │
│  ┌──────────────┐   ┌──────────────┐      │
│  │ Core Layer   │   │ Store Layer  │      │
│  │ (core.js)    │   │ (store.js)   │      │
│  │              │   │              │      │
│  │ • alloc      │   │ • loadDB     │      │
│  │ • balances   │   │ • saveDB     │      │
│  │ • simplify   │   │ • baseData   │      │
│  └──────────────┘   └──────────────┘      │
│                                             │
└─────────────────────────────────────────────┘
```

## Calculation Walkthrough

**Scenario:** Alice and Bob form a project.
- Alice deposits ₹1000
- Bob buys groceries for ₹600, split equally
- Alice buys coffee for ₹100, Bob pays

**Step 1: Load Data**
```javascript
project = { people: [alice, bob], transactions: [...] }
```

**Step 2: Expense Shares**
```javascript
expenseShares(project)
→ { alice: 100 + 300, bob: 0 + 300 } // Both split equally
→ { alice: 400, bob: 300 }
```

**Step 3: Balances**
```javascript
balances(project)

// Start: { alice: 0, bob: 0 }

// Deposits: alice -1000, bob: 0
→ { alice: -1000, bob: 0 }

// Expenses: alice paid 100, bob paid 600 (both credited)
→ { alice: -1000 + 100, bob: 600 }
→ { alice: -900, bob: 600 }

// Subtract shares: alice -400, bob -300
→ { alice: -900 - 400, bob: 600 - 300 }
→ { alice: -1300, bob: 300 }

// Settlements: (none yet)
→ { alice: -1300, bob: 300 }
```

**Alice owes ₹1300 more → Bob is owed ₹300**

**Step 4: Simplify**
```javascript
simplify(project)
→ [{ from: "alice", to: "bob", amount: 300 }]
// Not 1300 because bob already paid 600, so net is 300
```

## Performance Considerations

- **Complexity of balances():** O(n·t) where n = people, t = transactions
  - For ~100 people and ~1000 transactions: acceptable for UI
  - If scaling: consider memoization or incremental updates
  
- **Complexity of simplify():** O(n log n) for n people
  - Fast even for large groups

- **Rendering:** Full re-render on each change
  - Acceptable for ~100 active entities
  - If slower: optimize by re-rendering only changed sections

## Future Extensibility

### Easy Additions
- ✅ Export to CSV/JSON
- ✅ Data backups (localStorage snapshots)
- ✅ Undo/redo (transaction log)
- ✅ Print-friendly views
- ✅ Bulk operations (delete all, migrate people)

### Harder Additions
- 🔲 Backend sync (would need API + auth)
- 🔲 Real-time collaboration (websockets)
- 🔲 Advanced audit trail (who changed what when)
- 🔲 Custom allocation algorithms (beyond equal/amount/share)

### Code Changes Needed
- **For exports:** Add `export` button → call core functions → format + download
- **For undo:** Record operation history in state → implement `undo()` function
- **For backend:** Move DB layer to REST API → core functions stay pure

## Testing Strategy

### Unit Tests (hypothetical)
```javascript
// Test core.js in isolation
import { balances, simplify } from './core.js'

test('balances handles deposits correctly', () => {
  const project = { ... }
  const b = balances(project)
  expect(b.alice).toBe(-1300)
  expect(b.bob).toBe(300)
})
```

### Integration Tests (manual checklist)
- [ ] Create project → add people → log transactions → verify balances
- [ ] Edit transaction → confirm balances recalculate
- [ ] Delete transaction → confirm simplification updates
- [ ] Switch projects → confirm UI updates
- [ ] Hard refresh → confirm data persists

### Browser Testing
- Desktop: Chrome, Firefox, Safari
- Mobile: iOS Safari, Android Chrome
- Scenarios: Small groups (3 people, 10 tx) to large (50 people, 500 tx)
