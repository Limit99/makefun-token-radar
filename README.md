# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Limit99/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Limit99/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

LaunchLens — a token launch radar. It reads the sealed DefiLlama snapshot (758 protocols, as of 2026-11-14), screens out wrapped/staked/bridged products of tokens that already trade, and ranks all 198 remaining protocols that record no token by implied launch value. The model (`computeImpliedValue` in `lib/model.ts`) prices each protocol from the snapshot itself: `peerMultipleFor` takes the median market-cap/TVL the market pays live-token protocols in the same category, shrunk toward the global median by sample size; `momentumFactor`, `enduranceFactor`, `breadthFactor` and `scaleFactor` adjust for 7-day growth, years survived with no token, chain breadth and scale. Every row carries a seven-step farm plan from `farmPlaybookFor` — a category archetype, a capital tier from TVL, and the gas class of its first chain — each step with a cost and a duration. The dashboard is sortable and filterable with a per-protocol detail view (factor breakdown, live-peer comparison, full farm plan), and the live-token yardstick strip stays separate from the ranked board. All 40 watchlist protocols are covered, plus 158 early finds below the $50M floor.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Then open `out/dashboard/index.html` in a browser (serve the `out/` folder over HTTP so `data.js` loads). Node 22.18+, standard library only, no network.

---

<sub>Entered on [make.fun](https://make.fun/?ref=0gynx1gq&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
