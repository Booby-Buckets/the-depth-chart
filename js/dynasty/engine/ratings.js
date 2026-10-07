// Seven pillars -> sim attributes. The snapshot's pillarMap holds least-squares fits of each attribute on the
// pillars (+ height) over real 2026-27 projected lines, so a pillar that moves in a dynasty moves the
// attributes the way real players' numbers move together. Pure: no DOM, no Supabase.

const PILLARS = ['SCO', 'SHT', 'FIN', 'PLY', 'SEC', 'REB', 'DEF'];
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export function attributes(player, snap) {
  const P = player.pillars, ht = player.ht || snap.heightRef || 77;
  const val = attr => {
    const m = snap.pillarMap[attr];
    let v = 0;
    m.terms.forEach((t, i) => {
      const x = t === '1' ? 1 : t === 'ht' ? (ht - (snap.heightRef || 77)) / 3 : (P[t] - 50) / 15;
      v += m.coef[i] * x;
    });
    return v;
  };
  return {
    use40: clamp(val('use40'), 3, 40),       // possessions used per 40
    r3: clamp(val('r3'), 0, 0.85),           // 3PA / FGA
    p3: clamp(val('p3'), 0.15, 0.48),
    p2: clamp(val('p2'), 0.30, 0.72),
    ftr: clamp(val('ftr'), 0.05, 0.9),       // FTA / FGA
    ftp: clamp(val('ftp'), 0.35, 0.95),
    ast40: clamp(val('ast40'), 0.2, 12),
    tovp: clamp(val('tovp'), 0.04, 0.40),    // turnovers per possession used
    or40: clamp(val('or40'), 0.1, 7),
    dr40: clamp(val('dr40'), 0.5, 13),
    stl40: clamp(val('stl40'), 0.2, 4.5),
    blk40: clamp(val('blk40'), 0, 6),
    def: (P.DEF - 50) / 15,                   // on-ball pressure (steals / forced turnovers), SD units
    def100: def100(player, snap),             // DRtg points saved per 100 (snapshot defMap), + = better
    ovr: overall(player, snap),
  };
}

// OVR rebuilt from pillars + height (snapshot ovrMap) — what a dynasty shows as a player develops
export function overall(player, snap) {
  const m = snap.ovrMap, P = player.pillars, ht = player.ht || snap.heightRef || 77;
  let v = 0;
  m.terms.forEach((t, i) => { v += m.coef[i] * (t === '1' ? 1 : t === 'ht' ? (ht - (snap.heightRef || 77)) / 3 : (P[t] - 50) / 15); });
  return v;
}

// Defensive impact: team projected DRtg fit on talent (overall z) + the DEF pillar (snapshot defMap)
export function def100(player, snap) {
  const m = snap.defMap;
  const oz = (overall(player, snap) - m.ovr_mu) / m.ovr_sd;
  return m.coef[0] * oz + m.coef[1] * (player.pillars.DEF - 50) / 15;
}

// G (ball handler) / W (wing) / B (big) for lineup rules
export function group(p) {
  const pos = (p.pos || '').toUpperCase();
  if (pos === 'PG' || pos === 'SG' || pos === 'G') return 'G';
  if (pos === 'PF' || pos === 'C') return 'B';
  if (pos === 'SF' || pos === 'GF' || pos === 'F' || pos === 'W') return 'W';
  const ht = p.ht || 78;
  return ht <= 76 ? 'G' : ht >= 81 ? 'B' : 'W';
}

// League reference values the possession model scales against (minutes-weighted over the snapshot).
export function leagueRefs(snap, byId) {
  let m = 0, ast = 0, stl = 0, blk = 0, orb = 0, drb = 0;
  for (const t of snap.teams) for (const id of t.players) {
    const p = byId[id]; if (!p) continue; const a = p.attr || attributes(p, snap), w = p.line.mpg;
    m += w; ast += a.ast40 * w; stl += a.stl40 * w; blk += a.blk40 * w; orb += a.or40 * w; drb += a.dr40 * w;
  }
  return { ast40: ast / m, stl40: stl / m, blk40: blk / m, or40: orb / m, dr40: drb / m };
}

// A team ready to simulate: roster with attributes + minute targets summing to 200.
export function prepareTeam(team, byId, snap, C) {
  let roster = team.players.map(id => byId[id]).filter(p => p && !p.injured && p.line.mpg > 0);
  const tot = roster.reduce((s, p) => s + p.line.mpg, 0) || 1;
  roster = roster.map(p => ({
    id: p.id, name: p.name, pos: p.pos, group: group(p), pillars: p.pillars,
    target: p.line.mpg * 200 / tot,           // minutes per 40
    attr: p.attr || attributes(p, snap),
  })).sort((a, b) => b.target - a.target);
  return {
    name: team.name, conf: team.conf, tempo: team.tempo || C.LG_PACE, roster,
    sysDef: C.SYS_DEF_W * (team.sysDef || 0),   // scheme / coaching defense, DRtg points per 100 (+ = better)
    offLevel: C.LEVEL_OFF_K * (team.level || 0) / 10,
    defLevel: C.LEVEL_DEF_K * (team.level || 0) / 10,
  };
}

export { PILLARS };
