// One possession: pick who acts, then resolve turnover / shot type / make or miss / fouls / rebound.
// An offensive rebound keeps the possession alive (a new play), so one possession can hold several shots.
// Pure: reads the two on-floor units + constants, writes counting stats into box rows and (optionally)
// events into a log array. No DOM, no Supabase.

const logit = p => Math.log(p / (1 - p));
const sigm = x => 1 / (1 + Math.exp(-x));
// the part of a lead beyond `free` points, capped at 25 (close games play straight up)
const cushion = (lead, free) => Math.sign(lead) * Math.min(25, Math.max(0, Math.abs(lead) - free));
const adj = (p, dx) => sigm(logit(Math.min(0.995, Math.max(0.005, p))) + dx);

// Summaries of a five-man unit the play model needs (recomputed only when the lineup changes).
export function unitStats(five) {
  let def = 0, def100 = 0, stl = 0, blk = 0, or = 0, dr = 0, ast = 0;
  const useW = [];
  for (const p of five) {
    const a = p.attr;
    def += a.def; def100 += a.def100; stl += a.stl40; blk += a.blk40; or += a.or40; dr += a.dr40; ast += a.ast40;
  }
  return { def: def / five.length, def100: def100 / five.length, stl, blk, or, dr, ast, useW };
}

function pickBy(rng, five, f, skip) {
  const w = five.map(p => (p === skip ? 0 : Math.max(0, f(p))));
  return five[rng.pick(w)];
}

/**
 * @param o   offense {team, five, unit, box(id)->row, home:boolean}
 * @param d   defense {team, five, unit, box(id)->row}
 * @param env {C, L (league refs), rng, log (array|null), t (clock sec), side (0|1)}
 * @returns points scored
 */
export function runPossession(o, d, env) {
  const { C, L, rng, log } = env;
  const five = o.five, A = o.unit, D = d.unit;
  const hca = o.home ? C.HCA_K : 0;
  const lv = o.team.offLevel - d.team.defLevel           // conference-strength correction (logit)
    - C.LEAD_K * cushion(env.lead || 0, C.LEAD_FREE) / 10   // game state: a comfortable lead coasts, a big deficit presses
    + (env.mom || 0);                                        // momentum / a timeout's set play + fresher legs (game.js)
  let pts = 0;
  const ev = (ty, p, x) => { if (log) log.push(Object.assign({ t: Math.round(env.t), s: env.side, ty, p: p && p.id }, x)); };

  // fouls that give no free throws
  if (rng.chance(C.NS_FOUL)) { const f = pickBy(rng, d.five, p => 1 + p.attr.blk40 * 0.3); d.box(f).pf++; ev('pf', f); }

  for (let play = 0; play < 8; play++) {                  // cap on offensive-rebound loops
    // actor: usage-weighted among the five
    const w = five.map(p => Math.pow(p.attr.use40, C.USE_POW));
    const a = five[rng.pick(w)], aa = a.attr, row = o.box(a);

    // turnover
    const press = d.team.press || 0;
    const fat = a.fat || 0;                                  // minutes a night past his stamina threshold (program.js)
    const pTo = adj(aa.tovp * C.TOV_MULT, C.DEF_TOV_K * D.def - 0.5 * lv + C.PLAN_PRESS_TOV * press + 0.015 * fat);
    if (rng.chance(pTo)) {
      row.tov++;
      const stlP = Math.min(0.9, C.STL_SHARE * D.stl / (5 * L.stl40));
      if (rng.chance(stlP)) { const s = pickBy(rng, d.five, p => p.attr.stl40); d.box(s).stl++; ev('to', a, { stl: s.id }); }
      else ev('to', a);
      return pts;
    }

    // shooting foul (FT trip with no FGA) vs field-goal attempt.  FTA/FGA = (2q + and1*fg)/(1-q)
    const three = rng.chance(Math.min(0.9, aa.r3 * C.R3_MULT * (o.team.r3m || 1)));
    const pMake = adj(three ? aa.p3 * C.P3_MULT : aa.p2 * C.P2_MULT,
      hca + lv - C.DEF_PTS_K * (D.def100 + d.team.sysDef) + (o.team.shotQ || 0) + C.PLAN_PRESS_MAKE * press
      + C.TALENT_K * ((o.team.q || 0) - (d.team.q || 0)) / 5 - 0.012 * fat);
    const ftr = aa.ftr * C.FTR_MULT * (1 + C.PLAN_PRESS_FTR * press), c1 = C.AND1 * pMake;
    const q = Math.max(0, (ftr - c1) / (2 + ftr - c1));
    let missed = false, ftMissLast = false;

    if (rng.chance(q)) {                                   // fouled in the act, shot missed: 2 or 3 FTs
      const f = pickBy(rng, d.five, p => 1 + p.attr.blk40 * 0.3); d.box(f).pf++;
      const n = three ? 3 : 2; let made = 0;
      for (let i = 0; i < n; i++) {
        row.fta++;
        if (rng.chance(aa.ftp * C.FT_MULT)) { row.ftm++; made++; ftMissLast = false; } else ftMissLast = i === n - 1;
      }
      row.pts += made; pts += made; ev('ft', a, { n, m: made });
      if (!ftMissLast) return pts;
      missed = true;
    } else {
      row.fga++; if (three) row.tpa++;
      if (rng.chance(pMake)) {
        const v = three ? 3 : 2; row.fgm++; if (three) row.tpm++; row.pts += v; pts += v;
        // assist: teammates' passing vs a league-average four-man unit
        const mates = A.ast - aa.ast40;
        const pa = Math.min(0.95, (three ? C.AST_BASE3 : C.AST_BASE2) * mates / (4 * L.ast40));
        let ast = null;
        if (rng.chance(pa)) { ast = pickBy(rng, five, p => p.attr.ast40, a); o.box(ast).ast++; }
        // and-one
        let and1 = 0;
        if (rng.chance(C.AND1)) {
          const f = pickBy(rng, d.five, p => 1 + p.attr.blk40 * 0.3); d.box(f).pf++;
          row.fta++; if (rng.chance(aa.ftp * C.FT_MULT)) { row.ftm++; row.pts++; pts++; and1 = 1; }
        }
        ev(three ? 'fg3' : 'fg2', a, { m: 1, ast: ast && ast.id, and1 });
        return pts;
      }
      // miss — a missed 2 may be a block
      let blk = null;
      if (!three && rng.chance(Math.min(0.5, C.BLK_RATE * D.blk / (5 * L.blk40)))) {
        blk = pickBy(rng, d.five, p => p.attr.blk40); d.box(blk).blk++;
      }
      ev(three ? 'fg3' : 'fg2', a, { m: 0, blk: blk && blk.id });
      missed = true;
    }

    // rebound
    if (missed) {
      let pO = A.or / (A.or + C.OREB_LAMBDA * D.dr);
      if (ftMissLast) pO *= C.FT_OREB_F;
      if (rng.chance(pO)) {
        if (rng.chance(C.TEAM_REB)) { ev('orb', null); continue; }
        const r = pickBy(rng, five, p => p.attr.or40); o.box(r).orb++; ev('orb', r);
        continue;                                          // same possession, new play
      }
      if (rng.chance(C.TEAM_REB)) { ev('drb', null); return pts; }   // team rebound
      const r = pickBy(rng, d.five, p => p.attr.dr40); d.box(r).drb++; ev('drb', r);
      return pts;
    }
  }
  return pts;
}
