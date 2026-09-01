# Contributing to Trust the Split

We welcome contributions! Whether it's bug fixes, features, or documentation, every bit helps.

## How to Contribute

### 1. Report a Bug
- Open an [issue](https://github.com/Samyak-M/trust-the-split/issues) with:
  - Clear title and description
  - Steps to reproduce
  - Expected vs. actual behavior
  - Browser/OS if relevant

### 2. Suggest a Feature
- Open an [issue](https://github.com/Samyak-M/trust-the-split/issues) with `[Feature Request]` in the title
- Explain the use case and why it would be useful
- Include mockups or examples if helpful

### 3. Submit Code

#### Setup
```bash
git clone https://github.com/Samyak-M/trust-the-split.git
cd trust-the-split
npm install
npm run dev
```

#### Make Changes
1. Create a feature branch: `git checkout -b feature/my-feature`
2. Make changes (keep files organized as follows):
   - **Logic changes** → `src/core.js` (pure functions)
   - **Persistence** → `src/store.js`
   - **UI/Events** → `src/main.js`
   - **Styles** → `styles.css`
3. Test in the browser (open http://localhost:8000)

#### Testing Checklist
- [ ] Create/edit/delete each entity (projects, people, transactions)
- [ ] Test all transaction types (deposit, expense)
- [ ] Test all sharing modes (equal, custom amounts, shares)
- [ ] Verify balance calculations (use sample data first)
- [ ] Record settlements and confirm updates
- [ ] Hard refresh browser and verify data persists
- [ ] Test on mobile (DevTools)
- [ ] Clear localStorage and test with fresh data

#### Commit & Push
```bash
git add .
git commit -m "Add feature: description"
git push origin feature/my-feature
```

#### Open a PR
- Link any related issues
- Describe what changed and why
- Reference testing done

## Code Guidelines

### Style
- Use ES6+ syntax (arrow functions, const/let, template literals)
- Keep functions pure (no global mutations in `core.js`)
- Prefer `const`, use `let` sparingly, avoid `var`
- Use descriptive variable names

### Performance
- Avoid unnecessary DOM updates (batch when possible)
- Keep `core.js` functions fast (no loops over 10k+ items without optimization)
- Cache function results if called repeatedly in render

### Accessibility
- Use semantic HTML (`<button>`, `<table>`, `<label>`)
- Test keyboard navigation (Tab, Enter, Escape)
- Ensure color contrast meets WCAG standards
- Add `aria-label` to icon-only buttons

### Comments
- Add comments only for WHY, not WHAT (code should be self-explanatory)
- Document non-obvious algorithms (e.g., the simplification greedy approach)

## File Structure

```
src/core.js      — Pure calculation functions (no UI, no DOM access)
src/store.js     — localStorage API + sample data
src/main.js      — Event handlers, rendering, DOM manipulation
index.html       — Structure only (no inline styles or scripts)
styles.css       — All styling (single file for simplicity)
```

## Commit Message Format

```
<type>: <subject>

<body (optional)>

Examples:
- "fix: correct balance calculation for unequal shares"
- "feat: add data export to JSON"
- "docs: improve core.js function documentation"
- "refactor: extract transaction filter into helper"
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`

## Questions?

- Check existing issues and PRs first
- Start a discussion in the issues tab
- Email: mukherjeesamyak88@gmail.com

Thanks for contributing! 🙏
