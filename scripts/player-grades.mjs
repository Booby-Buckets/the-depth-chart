/**
 * player-grades.js
 * The Depth Chart — 25–99 player grading engine
 *
 * PIPELINE (multi-pass, because z-scores need the whole population):
 *   1. computeStatNorms  → mean/sd of every raw stat across the pool
 *   2. rawPillarScore    → per player, weighted mean of that pillar's z-scores
 *   3. computePillarNorms→ re-standardize each pillar across the pool
 *   4. composite         → weighted blend of the 7 standardized pillars  → C
 *   5. standardize C     → mean 0, sd 1
 *   6. adjust C          → × games-reliability, + size/position nudge
 *   7. logistic map      → 25–99
 *
 * Size and games-played are NOT additive pillars. Size is a small
 * positional context nudge; games-played is a reliability multiplier
 * that pulls thin-sample players toward the league average.
 *
 * Usage:
 *   import { gradePlayers } from './player-grades.js';
 *   const graded = gradePlayers(allPlayers); // returns [...players, grade, debug]
 */

// ============================================================
// 1. CONFIG — the two decisions that change everything
// ============================================================
export const CONFIG = {
  // 'value'  = current production/value (default)
  // 'upside' = tilt toward per-possession skill, creation, scalability
  mode: 'value',

  // 'all'      = z-score every stat vs the entire D1 pool (default)
  // 'position' = z-score within position group (PG vs PG, C vs C, ...)
  //              requires a player.pos field ('PG','SG','SF','PF','C')
  standardize: 'all',

  logistic: {
    k: 1.6,       // spread — higher = more separation at the tails
    center: 0.0,  // composite value that lands on the curve midpoint
                  // raise ~0.3 to push the average player below 62
    floor: 25,
    span: 74,     // floor + span = 99 ceiling
  },

  reliability: {
    fullGames: 28,   // 28+ games => full weight (1.0)
    floor: 0.70,     // multiplier for ~0 games (pulls toward average)
    minMpgForRates: 10, // under this MPG, per-40 scalability stats are nulled
  },

  size: {
    weight: 0.15,    // max nudge (in composite-sd units) from size/position
  },
};

// ============================================================
// 2. PILLAR WEIGHTS (across pillars) — must sum to 1.0
// ============================================================
const PILLAR_WEIGHTS = {
  value: {
    impact: 0.23, offense: 0.19, efficiency: 0.15, defense: 0.15,
    creation: 0.11, usage: 0.09, scalability: 0.08,
  },
  upside: {
    offense: 0.20, efficiency: 0.17, impact: 0.16, creation: 0.13,
    defense: 0.13, usage: 0.11, scalability: 0.10,
  },
};

// ============================================================
// 3. STAT REGISTRY  (pillar -> [{ key, w, neg, rate }])
//    key  : field name on the player object (remap to your Supabase cols)
//    w    : within-pillar weight (auto-normalized over non-null stats)
//    neg  : true => lower is better, sign is flipped before averaging
//    rate : true => per-40 stat that gets nulled below minMpgForRates
// ============================================================
const PILLARS = {
  offense: [
    { key: 'ppg',        w: 1 },
    { key: 'fgaToFgPct', w: 1 }, // NOTE: clarify this label — ambiguous
    { key: 'fta',        w: 1 },
    { key: 'ppg40',      w: 1 },
    { key: 'obpm',       w: 1 },
    { key: 'ows',        w: 1 },
  ],
  efficiency: [
    { key: 'tsPct', w: 0.60 },   // anchor — already contains FG/3P/FT
    { key: 'tpPct', w: 0.133 },
    { key: 'fgPct', w: 0.133 },
    { key: 'ftPct', w: 0.133 },
  ],
  creation: [
    { key: 'ast',    w: 1 },
    { key: 'astPct', w: 1 },
    { key: 'pprod',  w: 1 },
    { key: 'orb',    w: 1 },           // arguably an offense/hustle input
    { key: 'to',     w: 1, neg: true },
    { key: 'tovPct', w: 1, neg: true },
  ],
  usage: [
    { key: 'usgPct', w: 1 },          // high usage is not inherently good
    { key: 'per',    w: 1 },
    { key: 'apg40',  w: 1 },
    { key: 'mpg',    w: 1 },
  ],
  impact: [
    { key: 'wa',    w: 0.18 },
    { key: 'ws',    w: 0.18 },
    { key: 'bpm',   w: 0.18 },
    { key: 'glsT1', w: 0.18 },        // performance vs top-tier opponents
    { key: 'glsT2', w: 0.12 },
    { key: 'glsT3', w: 0.09 },
    { key: 'glsT4', w: 0.07 },
  ],
  defense: [
    { key: 'stl', w: 1 },
    { key: 'blk', w: 1 },
    { key: 'drb', w: 1 },
    { key: 'pf',  w: 1, neg: true },  // fouls are a negative
  ],
  scalability: [
    { key: 'fga40', w: 1, rate: true },          // volume — debatable sign
    { key: 'fta40', w: 1, rate: true },          // drawing fouls = positive
    { key: 'pf40',  w: 1, rate: true, neg: true },
    { key: 'to40',  w: 1, rate: true, neg: true },
  ],
};

// Size handled separately (not an additive pillar)
const SIZE = { heightVsPos: 'heightVsPos', height: 'height' };

// ============================================================
// 4. STAT-LEVEL HELPERS
// ============================================================
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

function meanSd(values) {
  const xs = values.filter((v) => v !== null);
  if (xs.length === 0) return { mean: 0, sd: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return { mean, sd: Math.sqrt(variance) };
}

const z = (x, { mean, sd }) => (sd === 0 || x === null ? 0 : (x - mean) / sd);

// Apply per-player null rules (thin-sample rate stats)
function effectiveStat(player, stat) {
  const v = num(player[stat.key]);
  if (v === null) return null;
  if (stat.rate && num(player.mpg) !== null &&
      player.mpg < CONFIG.reliability.minMpgForRates) {
    return null;
  }
  return v;
}

// ============================================================
// 5. NORMS
// ============================================================
function groupKey(player) {
  return CONFIG.standardize === 'position' ? (player.pos || 'NA') : 'ALL';
}

// stat norms, keyed by group -> statKey -> {mean, sd}
function computeStatNorms(players) {
  const groups = {};
  for (const p of players) {
    const g = groupKey(p);
    (groups[g] ||= []).push(p);
  }
  const norms = {};
  for (const [g, pool] of Object.entries(groups)) {
    norms[g] = {};
    for (const stats of Object.values(PILLARS)) {
      for (const stat of stats) {
        if (norms[g][stat.key]) continue;
        norms[g][stat.key] = meanSd(pool.map((p) => effectiveStat(p, stat)));
      }
    }
    for (const k of Object.values(SIZE)) {
      norms[g][k] = meanSd(pool.map((p) => num(p[k])));
    }
  }
  return norms;
}

// ============================================================
// 6. RAW PILLAR SCORE (weighted mean of available z-scores)
// ============================================================
function rawPillarScore(player, pillarStats, statNorms) {
  let wSum = 0;
  let acc = 0;
  for (const stat of pillarStats) {
    const v = effectiveStat(player, stat);
    if (v === null) continue;                 // skip missing/nulled stats
    let zi = z(v, statNorms[stat.key]);
    if (stat.neg) zi = -zi;                    // flip negatives
    acc += zi * stat.w;
    wSum += stat.w;
  }
  return wSum === 0 ? 0 : acc / wSum;          // re-normalize over present stats
}

// ============================================================
// 7. RELIABILITY + SIZE
// ============================================================
function reliability(player) {
  const { fullGames, floor } = CONFIG.reliability;
  const g = num(player.gamesPlayed);
  if (g === null) return 1;
  const r = floor + (1 - floor) * Math.min(g / fullGames, 1);
  return Math.min(r, 1);
}

function sizeNudge(player, statNorms) {
  // primarily height-relative-to-position; raw height as a faint tiebreak
  const zPos = z(num(player.heightVsPos), statNorms.heightVsPos);
  const zRaw = z(num(player.height), statNorms.height);
  const zSize = 0.8 * zPos + 0.2 * zRaw;
  return CONFIG.size.weight * zSize;           // in composite-sd units
}

// ============================================================
// 8. LOGISTIC MAP → 25–99
// ============================================================
function toScore(C) {
  const { k, center, floor, span } = CONFIG.logistic;
  const s = floor + span / (1 + Math.exp(-k * (C - center)));
  return Math.round(Math.max(floor, Math.min(floor + span, s)));
}

// ============================================================
// 9. MAIN
// ============================================================
export function gradePlayers(players) {
  if (!Array.isArray(players) || players.length === 0) return [];

  const weights = PILLAR_WEIGHTS[CONFIG.mode];
  const pillarKeys = Object.keys(weights);

  // Pass 1 — stat norms
  const statNormsByGroup = computeStatNorms(players);

  // Pass 2 — raw pillar scores per player
  const rawPillars = players.map((p) => {
    const norms = statNormsByGroup[groupKey(p)];
    const out = {};
    for (const k of pillarKeys) out[k] = rawPillarScore(p, PILLARS[k], norms);
    return out;
  });

  // Pass 3 — pillar norms (re-standardize each pillar across pool)
  const pillarNorms = {};
  for (const k of pillarKeys) {
    pillarNorms[k] = meanSd(rawPillars.map((rp) => rp[k]));
  }

  // Pass 4 — weighted composite of standardized pillars
  const composites = rawPillars.map((rp) => {
    let C = 0;
    const std = {};
    for (const k of pillarKeys) {
      std[k] = z(rp[k], pillarNorms[k]);
      C += std[k] * weights[k];
    }
    return { C, std };
  });

  // Pass 5 — standardize the composite itself
  const compNorm = meanSd(composites.map((c) => c.C));

  // Pass 6/7 — adjust + map
  return players.map((p, i) => {
    const norms = statNormsByGroup[groupKey(p)];
    let C = z(composites[i].C, compNorm);
    const rel = reliability(p);
    const size = sizeNudge(p, norms);

    C = C * rel + size;                  // reliability shrinks toward mean; size nudges

    const grade = toScore(C);

    return {
      ...p,
      grade,
      _debug: {
        pillars: composites[i].std,      // standardized pillar scores
        compositeStd: C,
        reliability: rel,
        sizeNudge: size,
      },
    };
  });
}

export default gradePlayers;
