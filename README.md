# StallSplit — Split UI + Core refactor (prototype)

This repo contains a small prototype for shared-project finance. I split the prototype into:
- src/core.js — pure calculation functions (allocations, balances, simplify)
- src/store.js — localStorage persistence and initial dataset
- src/main.js — UI wiring (importing core + store)
- index.html + styles.css

How to run:
1. Serve the repository using a simple static server (recommended):
   - python3 -m http.server 8000
   - open http://localhost:8000
2. The UI stores data in localStorage (key: stallSplit_v4).

If you'd like, I can push these files into the split-core-ui branch and open a PR. Reply "Go ahead" to have me push and create a PR with these changes.
