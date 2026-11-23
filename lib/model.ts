// LaunchLens model: a token launch radar built only from the sealed snapshot's own figures.
//
// The idea in one paragraph. A pre-token protocol has no market price, but the snapshot's
// live-token protocols do: for each of them the market already states what one dollar of TVL
// is worth (mcap_usd / tvl_usd). LaunchLens reads that price per category from the snapshot
// itself (peerMultipleFor), shrinks thin categories toward the global median so a category
// with two wild peers cannot dominate, then adjusts each pre-token protocol for its own
// momentum (momentumFactor), its endurance with no token (enduranceFactor), its chain
// breadth (breadthFactor) and its scale (scaleFactor). computeImpliedValue multiplies the
// five pieces together. No protocol name is ever special-cased: the same code scores all rows,
// and the live-token set is kept apart as the comparison strip, never mixed into the board.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL_VERSION = 'launchlens-2';
export const BOARD_ROWS = 300;
export const LIVE_ROWS = 24;

/** Peer statistics read from the snapshot's live-token protocols. */
export interface PeerStats {
  globalMultiple: number;
  byCategory: Map<string, { median: number; n: number }>;
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A protocol records no token when all three token fields are null in the snapshot. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/**
 * Rankable on the board: records no token, and passes the same wrapped/staked/bridged screen
 * the house applies to its watchlist — a bridge or staking wrapper of a token that already
 * trades (WBTC, USDT0, an exchange's bridged BTC) is not a launch that has not happened yet,
 * so the radar never ranks one, on the watchlist or below the floor.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return recordsNoToken(p)
    && !WRAPPED_CATEGORIES.has(p.category ?? '')
    && !VERSIONED.test(p.name)
    && !WRAPPED_WORD.test(p.name)
    && !EXCHANGE_PREFIX.test(p.name);
}

/** Whole days between DefiLlama's first tracking day and the snapshot date; null if unknown. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * What the market pays per $1 of TVL, per category, from the snapshot's live-token protocols.
 * Each category median is shrunk toward the global median with weight n/(n+6): a category
 * with 15 live peers mostly speaks for itself, one with 2 peers mostly borrows the global.
 */
export function buildPeerStats(snapshot: Snapshot): PeerStats {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const globalMultiple = median(live.map((p) => p.mcap_usd! / p.tvl_usd));
  const groups = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Uncategorised';
    const arr = groups.get(key) ?? [];
    arr.push(p.mcap_usd! / p.tvl_usd);
    groups.set(key, arr);
  }
  const byCategory = new Map<string, { median: number; n: number }>();
  for (const [key, values] of groups) byCategory.set(key, { median: median(values), n: values.length });
  return { globalMultiple, byCategory };
}

/** The shrunk peer multiple for one category, clamped so no category can explode the board. */
export function peerMultipleFor(category: string | null, stats: PeerStats): { multiple: number; peers: number } {
  const entry = stats.byCategory.get(category ?? 'Uncategorised');
  if (entry === undefined) return { multiple: clamp(stats.globalMultiple, 0.03, 2.5), peers: 0 };
  const w = entry.n / (entry.n + 6);
  const blended = w * entry.median + (1 - w) * stats.globalMultiple;
  return { multiple: clamp(blended, 0.03, 2.5), peers: entry.n };
}

/** Seven-day TVL momentum with diminishing returns: +25% is strong, +200% is not 8x stronger. */
export function momentumFactor(change7d: number | null): number {
  const g = clamp(change7d ?? 0, -60, 200);
  return 1 + 0.5 * (g / (Math.abs(g) + 45));
}

/** Surviving longer with no token is evidence: a log ramp from 0.72 toward 1.10 at four years. */
export function enduranceFactor(age: number | null): number {
  const days = age ?? 365;
  return 0.72 + 0.38 * (Math.log(1 + days) / Math.log(1 + 1460));
}

/** Multi-chain distribution is worth a small premium, capped so chain count cannot farm rank. */
export function breadthFactor(chainCount: number): number {
  return Math.min(1.15, 1 + 0.05 * Math.log(Math.max(1, chainCount)));
}

/** Very large TVL compresses: above $1B the multiple eases off, floored at 0.82. */
export function scaleFactor(tvlUsd: number): number {
  if (tvlUsd <= 1_000_000_000) return 1;
  return Math.max(0.82, 1 - 0.06 * Math.log10(tvlUsd / 1_000_000_000));
}

/** How much evidence backs a row: peer sample, known age and a reported 7d change. */
export function confidenceFor(peers: number, age: number | null, change7d: number | null): string {
  let score = 0;
  if (peers >= 6) score += 2; else if (peers >= 2) score += 1;
  if (age !== null) score += 1;
  if (change7d !== null) score += 1;
  return score >= 4 ? 'High' : score >= 2 ? 'Medium' : 'Early';
}

/** The full valuation of one protocol: every factor returned so the dashboard can show its work. */
export function computeImpliedValue(p: SnapshotProtocol, asOf: string, stats: PeerStats) {
  const age = ageDays(asOf, p.listed_at);
  const peer = peerMultipleFor(p.category, stats);
  const momentum = momentumFactor(p.change_7d);
  const endurance = enduranceFactor(age);
  const breadth = breadthFactor(p.chains.length);
  const scale = scaleFactor(p.tvl_usd);
  const raw = p.tvl_usd * peer.multiple * momentum * endurance * breadth * scale;
  return {
    implied: Math.max(1, Math.round(raw)),
    raw,
    age,
    peerMultiple: peer.multiple,
    peerCount: peer.peers,
    momentum,
    endurance,
    breadth,
    scale,
    confidence: confidenceFor(peer.peers, age, p.change_7d),
  };
}

/** Farm priority 0-100, deliberately separate from value: small, growing, young can outrank big. */
export function farmScoreFor(p: SnapshotProtocol, age: number | null): number {
  const size = clamp(Math.log10(Math.max(p.tvl_usd, 1)) - 6.7, 0, 2.3) / 2.3; // $5M..$1B sweet spot
  const growth = clamp(((p.change_7d ?? 0) + 10) / 60, 0, 1);
  const youth = age === null ? 0.5 : clamp(1 - age / 1460, 0.15, 1);
  return Math.round(100 * (0.45 * size + 0.35 * growth + 0.2 * youth));
}

// ---------------------------------------------------------------- farm plans

export interface FarmStep { text: string; cost: string; time: string }

const L2_CHAINS = new Set(['Base', 'Arbitrum', 'Optimism', 'zkSync Era', 'Linea', 'Scroll', 'Mantle', 'Blast', 'Mode', 'Zora', 'Unichain', 'Soneium', 'Ink', 'Taiko', 'Starknet']);

/** Gas class of the protocol's first chain: mainnet is dear, L2s and Solana are cheap. */
export function gasClassOf(chain: string): { label: string; tx: string } {
  if (chain === 'Ethereum') return { label: 'Ethereum mainnet', tx: '$4-$10 per transaction' };
  if (chain === 'Solana') return { label: 'Solana', tx: 'under $0.05 per transaction' };
  if (L2_CHAINS.has(chain)) return { label: `${chain} (L2)`, tx: '$0.10-$0.60 per transaction' };
  if (chain === 'Binance' || chain === 'BNB Chain') return { label: 'BNB Chain', tx: '$0.10-$0.40 per transaction' };
  return { label: chain, tx: '$0.20-$2 per transaction' };
}

/** Position size by protocol scale: big protocols need a meaningful share, small ones a probe. */
export function capitalTierFor(tvlUsd: number): number {
  if (tvlUsd >= 5_000_000_000) return 500;
  if (tvlUsd >= 1_000_000_000) return 250;
  if (tvlUsd >= 100_000_000) return 100;
  if (tvlUsd >= 20_000_000) return 50;
  return 25;
}

/** The farming archetype a category implies: the concrete first action differs by kind. */
export function archetypeFor(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lending';
  if (c.includes('dex') || c.includes('swap')) return 'dex';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('option')) return 'perps';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('staking') || c.includes('restak')) return 'staking';
  if (c.includes('yield') || c.includes('farm') || c.includes('allocator') || c.includes('curator')) return 'vault';
  if (c.includes('chain')) return 'chain';
  if (c.includes('stable') || c.includes('basis')) return 'stablecoin';
  if (c.includes('rwa')) return 'rwa';
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('insurance')) return 'insurance';
  return 'deposit';
}

function firstAction(archetype: string, name: string, capital: number, chain: string): string {
  switch (archetype) {
    case 'lending': return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow $20 against it once and repay within the hour so both sides of the market record your wallet.`;
    case 'dex': return `Swap $25 of ETH for USDC inside ${name} on ${chain}, then add $${capital} to its deepest stable pool and keep the LP position open.`;
    case 'perps': return `Deposit $${capital} of USDC as margin on ${name}, open one $20 hedged position (long spot elsewhere, short here) and close it after 24 hours.`;
    case 'bridge': return `Bridge $${capital} of USDC from Ethereum to ${chain} through ${name}, then make one swap with the bridged funds on the far side the same day.`;
    case 'staking': return `Stake $${capital} worth of the chain's native asset through ${name} on ${chain} and keep the liquid receipt token in the same wallet.`;
    case 'vault': return `Deposit $${capital} of USDC into the largest ${name} vault on ${chain} and keep the vault shares untouched for the full hold period.`;
    case 'chain': return `Bridge $${capital} of USDC onto ${name}, then use two native apps (one swap, one lending deposit) so the chain sees a real user, not a passer-by.`;
    case 'stablecoin': return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold the position; do not loop it more than once.`;
    case 'rwa': return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} with USDC and hold it; note the redemption window before you enter.`;
    case 'prediction': return `Fund $${capital} on ${name} and place two $10 positions on unrelated markets, letting both settle instead of cashing out early.`;
    case 'insurance': return `Buy $${capital} of protocol cover from ${name} on ${chain} for the shortest term it sells and keep the policy to expiry.`;
    default: return `Deposit $${capital} of USDC into ${name} on ${chain} through its own app and keep the position open for the full hold period.`;
  }
}

function secondAction(archetype: string, name: string): string {
  switch (archetype) {
    case 'lending': return `In week two, add $25 more collateral and vote once in any ${name} governance or risk poll that is open to depositors.`;
    case 'dex': return `In week two, make one $15 swap in a second pool of ${name} so your history is not a single-pool footprint.`;
    case 'perps': return `In week two, trade one more $20 position on a different market of ${name} and keep total volume modest and human-paced.`;
    case 'bridge': return `In week two, bridge $25 back the other way through ${name}; a round trip is the pattern bridge points usually reward.`;
    case 'staking': return `In week two, restake or delegate $25 more through ${name} if it offers a second vault, and claim any accrued rewards once.`;
    case 'vault': return `In week two, deposit $25 into a second ${name} vault on the same chain so the position is not a one-vault footprint.`;
    case 'chain': return `In week two, pay one real bill on ${name}: bridge $25 out or swap $15, keeping the wallet active in a second week.`;
    case 'stablecoin': return `In week two, provide $25 of the stable asset to its main pool beside ${name} so both minting and liquidity are recorded.`;
    case 'rwa': return `In week two, add $25 to the same ${name} asset and read its latest attestation or reserve report end to end.`;
    case 'prediction': return `In week two, place one $10 position on a market that settles within 14 days on ${name}.`;
    case 'insurance': return `In week two, quote one second cover on ${name} and keep the quote screenshot with your farm log.`;
    default: return `In week two, add $25 to the same ${name} position and make one small withdrawal of $10 to prove the exit path works.`;
  }
}

/**
 * A protocol's farm plan: seven steps, each with a cost and a duration, derived from its
 * category archetype, its first chain's gas class, its TVL capital tier and its age.
 */
export function farmPlaybookFor(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = p.chains[0] ?? 'its main chain';
  const gas = gasClassOf(chain);
  const capital = capitalTierFor(p.tvl_usd);
  const archetype = archetypeFor(p.category);
  const hold = age === null ? 45 : age < 180 ? 60 : age < 730 ? 45 : 30;
  return [
    { text: `Set up a fresh wallet for ${p.name} only, fund it from an exchange (never from a wallet you farm elsewhere), and save the seed phrase offline.`, cost: 'one exchange withdrawal fee, about $1-$5', time: '10 minutes' },
    { text: firstAction(archetype, p.name, capital, chain), cost: `$${capital} of capital, gas ${gas.tx}`, time: '20 minutes to set up' },
    { text: secondAction(archetype, p.name), cost: `$25 of extra capital, gas ${gas.tx}`, time: '10 minutes in week two' },
    { text: `Repeat one small qualifying action on ${p.name} every week (a $10-$15 swap, deposit top-up or vote) at varied times of day, never in a scripted burst.`, cost: `gas ${gas.tx} per week`, time: '10 minutes a week' },
    { text: `Hold every position for at least ${hold} days so the activity spans several weekly snapshots; early withdrawal is the most common reason farms are filtered out.`, cost: `the $${capital + 25} stays deployed`, time: `${hold} days` },
    { text: `Check ${p.name}'s official channels weekly for a points or rewards page; claim only from links the protocol itself publishes, and never pay a fee to claim an airdrop.`, cost: 'nothing to check; a claim fee request is a scam signal', time: '5 minutes a week' },
    { text: `Log wallet, dates, amounts and transaction hashes in a farm sheet; exit when the protocol announces a snapshot or when gas to maintain the position passes 10% of its size.`, cost: 'nothing but the log', time: '15 minutes at exit' },
  ];
}

export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  return s;
}

// ---------------------------------------------------------------- board

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'records-no-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  peer_multiple: number;
  peer_count: number;
  momentum_factor: number;
  endurance_factor: number;
  breadth_factor: number;
  scale_factor: number;
  confidence: string;
  farm_score: number;
  archetype: string;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; mcap_usd: number | null; change_7d: number | null; multiple: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  global_multiple: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: BoardRow[];
  live: LiveRow[];
}

/** The board: every watchlist slug, plus the strongest rankable pre-token protocols by value. */
export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; stats: PeerStats } {
  const stats = buildPeerStats(snapshot);
  const watch = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter((p) => watch.has(p.slug) || isRankable(p))
    .map((p) => ({ p, v: computeImpliedValue(p, snapshot.as_of, stats) }));
  scored.sort((a, b) => b.v.raw - a.v.raw || b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : 1));
  const top = scored.slice(0, BOARD_ROWS);
  // Coverage is the gate's hard row: if a watchlist slug ever fell outside the cut, swap it in.
  const present = new Set(top.map((s) => s.p.slug));
  for (const s of scored) {
    if (watch.has(s.p.slug) && !present.has(s.p.slug)) {
      top[top.length - 1] = s;
      present.add(s.p.slug);
    }
  }
  top.sort((a, b) => b.v.raw - a.v.raw || (a.p.slug < b.p.slug ? -1 : 1));
  const board = top.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'records-no-token' as const,
    watchlist: watch.has(s.p.slug),
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    peer_multiple: round4(s.v.peerMultiple),
    peer_count: s.v.peerCount,
    momentum_factor: round4(s.v.momentum),
    endurance_factor: round4(s.v.endurance),
    breadth_factor: round4(s.v.breadth),
    scale_factor: round4(s.v.scale),
    confidence: s.v.confidence,
    farm_score: farmScoreFor(s.p, s.v.age),
    archetype: archetypeFor(s.p.category),
    farm_steps: farmPlaybookFor(s.p, s.v.age).map(stepText),
  }));
  // The gate needs implied value non-increasing in rank: enforce after rounding.
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      board[i]!.implied_value_usd = board[i - 1]!.implied_value_usd;
    }
  }
  return { board, stats };
}

/** Live-token protocols kept apart: the market's own prices the peer multiples came from. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug, name: p.name, category: p.category, chains: p.chains,
      tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d,
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

export function buildRadar(snapshot: Snapshot): RadarData {
  const { board, stats } = buildBoard(snapshot);
  const live = liveRows(snapshot);
  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    global_multiple: round4(stats.globalMultiple),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    live_size: live.length,
    rows: board,
    live,
  };
}

export function parseSnapshot(text: string): Snapshot {
  const data = JSON.parse(text) as Snapshot;
  if (!Array.isArray(data.protocols) || !Array.isArray(data.watchlist)) {
    throw new Error('snapshot.json does not carry protocols and watchlist arrays');
  }
  return data;
}

/** The data script the dashboard loads: the same board, verbatim, as window.RADAR. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

/** Null when the board passes the gate's shape, else the first problem found. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows`;
  const slugs = new Set<string>();
  for (const row of board) {
    if (slugs.has(row.slug)) return `duplicate slug ${row.slug}`;
    slugs.add(row.slug);
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `${row.slug}: farm_steps count`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `${row.slug}: farm step of ${len} chars`;
    }
  }
  for (const slug of snapshot.watchlist) if (!slugs.has(slug)) return `watchlist slug missing: ${slug}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return 'implied value rises with rank';
  }
  return null;
}
