/* tdc-conftourney.js — 2026-27 conference standings + conference tournament projection.
 *
 * TDCConfT.project(code) simulates a league's season and its tournament together, in the SAME simulated
 * seasons every schedule on the site uses (tdc-schedule.js common random numbers):
 *   1. each member's schedule projection (TDCSched.project) → its conference wins in every sim s; because
 *      the two sides of a league game share one coin, the standings in sim s add up (one W per L)
 *   2. sim s's standings → seeds (league wins, then that sim's team strength as the tiebreaker — the
 *      better team usually owns head-to-head / NET tiebreaks)
 *   3. the league's REAL bracket (scripts/data/conf_tourneys_2027.json: who's invited, byes, pairings,
 *      reseeding, neutral site vs campus) played with that sim's team strengths, home edge on campus
 * Returns per team: projected league record, regular-season title odds (outright + shared), seed odds,
 * invite odds, odds to reach each round and to win the tournament (= the automatic bid).
 *
 * The format file is the research output: one entry per league code (matching conf_members_2027.json):
 *   {name, invited, site, venue, dates, host, reseed, games:[{id, round, a, b, site?}], round_names, notes, source}
 *   a / b = a seed number or "W:<game id>"; site per game 'N' (neutral) or 'H' (higher seed hosts).
 *   Reseeding leagues give round-1 games and `reseed_rounds`: the seeds that enter each later round.
 */
(function (g) {
  if (g.TDCConfT) return;
  let _fmt = null, _loading = null;
  function load() {
    if (_loading) return _loading;
    _loading = Promise.all([
      fetch('scripts/data/conf_tourneys_2027.json?v=1').then(r => r.ok ? r.json() : null).catch(() => null),
      g.TDCSched ? g.TDCSched.load() : null,
    ]).then(([f]) => { _fmt = f || { conferences: {} }; return _fmt; });
    return _loading;
  }
  const memo = {};

  async function project(code, opts) {
    opts = opts || {};
    await load();
    const S = g.TDCSched, R = g.TDC_RATINGS;
    if (!S || !R) return null;
    const D = await R.get(), sim = S.sim;
    const fmt = (_fmt.conferences || {})[code] || null;
    const mem = sim.members();
    const rowOf = n => D.teams.find(t => t.full === n) || null;
    const names = Object.keys((mem && mem.teams) || {}).filter(n => mem.teams[n] === code && rowOf(n));
    if (names.length < 2) return null;
    const SIMS = opts.sims || 2000, key = code + '|' + SIMS;
    if (memo[key]) return memo[key];
    // every member's season, on the shared draws
    const proj = {};
    for (const n of names) proj[n] = await S.project(n, { sims: SIMS });
    const T = names.filter(n => proj[n]);
    const STRETCH = R.GAP_STRETCH || 1, SIGMA = R.SIGMA || 11;
    const K = fmt ? Math.min(fmt.invited || T.length, T.length) : T.length;
    const rounds = fmt ? [...new Set((fmt.games || []).map(x => x.round))].sort((a, b) => a - b) : [];
    if (fmt && fmt.reseed) (fmt.reseed_rounds || []).forEach((_, i) => rounds.push(rounds[0] + i + 1));
    const out = {};
    T.forEach(n => { out[n] = { team: n, row: rowOf(n), confN: proj[n].confN, cw: 0, title: 0, outright: 0, seed: new Float64Array(K + 1),
      invited: 0, reach: {}, champ: 0, expW: proj[n].expW, n: proj[n].n }; rounds.forEach(r => out[n].reach[r] = 0); });
    const gkey = gid => sim.hkey('ct:' + code + ':' + gid);
    // per-sim detail for the NCAA / NIT projection (tdc-postseason.js) and the fantasy playoffs:
    // the tournament champion + runner-up and how many tournament games each member played
    const idxOf = {}; T.forEach((n, i) => idxOf[n] = i);
    const champS = new Int16Array(SIMS).fill(-1), ruS = new Int16Array(SIMS).fill(-1), gamesS = new Uint8Array(SIMS * T.length);
    // a league slate a school hasn't fully announced (MEAC / SWAC releases lag): the most common slate
    // length is the league's; the missing games are played against an average league opponent
    const lens = {}; T.forEach(n => { const c = proj[n].confN; lens[c] = (lens[c] || 0) + 1; });
    const slate = +Object.keys(lens).sort((a, b) => (lens[b] - lens[a]) || (b - a))[0];
    const missing = {}; T.forEach(n => { missing[n] = Math.max(0, slate - proj[n].confN); out[n].confN = proj[n].confN + missing[n]; out[n].filled = missing[n]; });
    const avgR = T.reduce((a, n) => a + (out[n].row.rating || 0), 0) / T.length;
    for (let s = 0; s < SIMS; s++) {
      const str = {}; T.forEach(n => { str[n] = out[n].row.rating + sim.TAU * sim.zTeam(s, n); });
      const cw = {}; T.forEach(n => {
        cw[n] = proj[n].CW[s];
        for (let k = 0; k < missing[n]; k++) { const p = sim.phi(sim.tame((str[n] - avgR) * STRETCH) / SIGMA); if (sim.U(7, s, sim.hkey('mg:' + n + ':' + k)) < p) cw[n]++; }
        out[n].cw += cw[n]; });
      const order = T.slice().sort((a, b) => (cw[b] - cw[a]) || (str[b] - str[a]));
      const top = cw[order[0]], tied = order.filter(n => cw[n] === top);
      tied.forEach(n => { out[n].title++; }); if (tied.length === 1) out[tied[0]].outright++;
      if (!fmt) continue;
      // teams under a postseason ban finish in the standings but aren't seeded (Horizon 2027: Detroit Mercy)
      const elig = order.filter(n => !(fmt.ineligible || []).includes(n));
      const seedTeam = {}; elig.slice(0, K).forEach((n, i) => { seedTeam[i + 1] = n; out[n].seed[i + 1]++; out[n].invited++; });
      const seedOf = {}; Object.keys(seedTeam).forEach(k => seedOf[seedTeam[k]] = +k);
      // one game: neutral, or the higher seed at home on campus
      let lastLoser = null;
      const play = (a, b, site, gid) => {
        out[a].reach[gameRound[gid]] = (out[a].reach[gameRound[gid]] || 0) + 1;
        out[b].reach[gameRound[gid]] = (out[b].reach[gameRound[gid]] || 0) + 1;
        gamesS[s * T.length + idxOf[a]]++; gamesS[s * T.length + idxOf[b]]++;
        let venue = 0;
        if (site === 'H') { const homeA = seedOf[a] < seedOf[b], H = homeA ? a : b, A = homeA ? b : a;
          const e = R.baseHca(out[A].row.rating) + (out[H].row.hcaOff || 0); venue = homeA ? e : -e; }
        const m = sim.tame((str[a] - str[b]) * STRETCH + venue), p = sim.phi(m / SIGMA);
        const w = sim.U(6, s, gkey(gid)) < p ? a : b; lastLoser = w === a ? b : a;
        return w;
      };
      const gameRound = {}; (fmt.games || []).forEach(x => gameRound[x.id] = x.round);
      let champ = null;
      if (!fmt.reseed) {
        const W = {}, roundWinners = {};
        // "W:<game>" = that game's winner; "RS:R<r>:k" = the k-th best original seed among round r's winners (Horizon's partial reseed)
        const slot = v => {
          if (typeof v === 'number') return seedTeam[v];
          const t = String(v);
          if (t.startsWith('RS:')) { const [, rr, k] = t.split(':'); return (roundWinners[+rr.slice(1)] || []).slice().sort((a, b) => seedOf[a] - seedOf[b])[+k - 1]; }
          return W[t.slice(2)];
        };
        for (const x of fmt.games) {
          const a = slot(x.a), b = slot(x.b);
          if (!a || !b) { W[x.id] = a || b; continue; }      // a seed that doesn't exist (league smaller this year)
          W[x.id] = play(a, b, x.site || (fmt.site === 'campus' ? 'H' : 'N'), x.id);
          (roundWinners[x.round] = roundWinners[x.round] || []).push(W[x.id]);
          champ = W[x.id];
        }
      } else {
        // reseeding: winners + the seeds entering that round, highest remaining seed vs lowest
        let alive = [];
        const r1 = fmt.games.filter(x => x.round === rounds[0]);
        r1.forEach(x => { const a = seedTeam[x.a], b = seedTeam[x.b]; if (a && b) alive.push(play(a, b, x.site || (fmt.site === 'campus' ? 'H' : 'N'), x.id)); else if (a || b) alive.push(a || b); });
        (fmt.reseed_rounds || []).forEach((enter, ri) => {
          const rd = rounds[0] + ri + 1;
          alive = alive.concat(enter.map(sd => seedTeam[sd]).filter(Boolean)).sort((a, b) => seedOf[a] - seedOf[b]);
          const nx = [];
          for (let i = 0; i < alive.length / 2; i++) {
            const a = alive[i], b = alive[alive.length - 1 - i], gid = 'R' + rd + 'G' + (i + 1);
            gameRound[gid] = rd; nx.push(play(a, b, fmt.round_site && fmt.round_site[rd] || (fmt.site === 'campus' ? 'H' : 'N'), gid));
          }
          alive = nx;
        });
        champ = alive[0];
      }
      if (champ) { out[champ].champ++; champS[s] = idxOf[champ]; if (lastLoser) ruS[s] = idxOf[lastLoser]; }
    }
    const res = T.map(n => {
      const o = out[n], k = SIMS;
      const seed = Array.from(o.seed).map(v => v / k);
      const avgSeed = o.invited ? seed.reduce((a, p, i) => a + p * i, 0) / (o.invited / k) : null;
      const reach = {}; rounds.forEach(r => reach[r] = o.reach[r] / k);
      return { team: n, row: o.row, confN: o.confN, filled: o.filled, cw: o.cw / k, cl: o.confN - o.cw / k, expW: o.expW, n: o.n,
        title: o.title / k, outright: o.outright / k, seed, avgSeed, invited: o.invited / k, reach, champ: o.champ / k };
    }).sort((a, b) => (b.cw - a.cw) || ((b.row.rating || 0) - (a.row.rating || 0)));
    return (memo[key] = { code, fmt, sims: SIMS, rounds, teams: res, names: T, proj, champS, ruS, gamesS });
  }

  g.TDCConfT = { load, project, formats: () => _fmt };
})(typeof window !== 'undefined' ? window : globalThis);
