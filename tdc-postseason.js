/* tdc-postseason.js — the 2026-27 NCAA Tournament + NIT, simulated from the regular season up.
 *
 * TDCPost.run() plays March out `sims` times, inside the SAME simulated seasons every schedule and
 * conference page uses (tdc-schedule.js common random numbers → tdc-conftourney.js):
 *   1. regular season (TDCSched.project) and every league's real conference tournament (TDCConfT)
 *   2. automatic bids: each tournament champion; a champion who can't go (reclassifying school, APR ban)
 *      hands the bid to its eligible runner-up, else the league's best eligible team
 *   3. at-large bids by a résumé score: that season's team strength (≈ NET, an efficiency rating) plus
 *      how far the team's record beat what its strength predicts (the committee sees results, not truth)
 *   4. the committee's bracket: S-curve by résumé, lowest at-larges / lowest automatic qualifiers into the
 *      First Four, four per seed line snaked across regions, a conference's teams kept apart
 *   5. the NCAA Tournament on neutral floors; the NIT from the teams left out under its own rules
 *      (automatic berths for the best teams of the named leagues, then at-large), higher seed at home
 *      until the semifinals
 * Every rule that changes year to year lives in scripts/data/postseason_rules_2027.json.
 *
 * Results per team: odds to make the NCAA field (auto / at-large), each seed, the First Four, every round
 * and the title; odds to make the NIT and reach each of its rounds. games(full, s, which) exposes the
 * per-sim game counts (conference tournament / NCAA first weekend / the rest) for the fantasy playoffs.
 */
(function (g) {
  if (g.TDCPost) return;
  const SO = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15];   // a region's bracket order
  const REGIONS = ['South', 'West', 'East', 'Midwest'];
  let _rules = null, _run = null;
  function loadRules() {
    if (_rules) return Promise.resolve(_rules);
    return fetch('scripts/data/postseason_rules_2027.json?v=1').then(r => r.ok ? r.json() : null).catch(() => null)
      .then(j => (_rules = j || {}));
  }
  const permute = a => a.length <= 1 ? [a] : a.flatMap((v, i) => permute(a.slice(0, i).concat(a.slice(i + 1))).map(p => [v, ...p]));
  const PERMS = permute([0, 1, 2, 3]);

  // place one seed line (4 entries) into regions: snake order, then the cheapest arrangement that keeps a
  // conference's teams apart (heavy on the top four lines — the committee's hard rule)
  function placeLine(line, s, regConf) {
    const pref = (s % 2 === 1) ? [0, 1, 2, 3] : [3, 2, 1, 0];
    let best = PERMS[0], bestCost = Infinity;
    for (const perm of PERMS) {
      let cost = 0;
      line.forEach((e, li) => { const rg = perm[li];
        e.confs.forEach(c => { cost += (regConf[rg][c] || 0) * (s <= 4 ? 1000 : 60); });
        cost += Math.abs(pref.indexOf(rg) - li); });
      if (cost < bestCost) { bestCost = cost; best = perm; }
    }
    line.forEach((e, li) => { const rg = best[li]; e.region = rg; e.confs.forEach(c => regConf[rg][c] = (regConf[rg][c] || 0) + 1); });
  }

  async function run(opts) {
    opts = opts || {};
    if (_run && !opts.fresh) return _run;
    return (_run = (async () => {
      const S = g.TDCSched, R = g.TDC_RATINGS, C = g.TDCConfT;
      if (!S || !R || !C) return null;
      await S.load(); await C.load();
      const rules = await loadRules(), D = await R.get(), sim = S.sim, mem = sim.members();
      const SIMS = opts.sims || 2000, SIGMA = R.SIGMA || 11, STRETCH = R.GAP_STRETCH || 1;
      const NC = rules.ncaa || {}, FIELD = NC.field || 68;
      const FF_AL = (NC.first_four && NC.first_four.at_large_teams) != null ? NC.first_four.at_large_teams : 4;
      const FF_AQ = (NC.first_four && NC.first_four.auto_teams) != null ? NC.first_four.auto_teams : 4;
      const INEL = new Set((rules.ineligible || []).map(x => x.team || x));
      const NIT = rules.nit || {}, NIT_N = NIT.field || 24, AQF = rules.aq_fallback || {};
      // NIT exempt bids: the top-N conferences by strength (KenPom's conference ranking ≈ our members' average
      // projected rating) get one each, plus the extra leagues (ACC, SEC)
      const RES = 12;   // résumé: +1 pt of selection score per 8.3% of win% above what the team's strength predicted
      const rowOf = {}; D.teams.forEach(t => rowOf[t.full] = t);
      // every league's season + tournament, on the shared draws
      const codes = [...new Set(Object.values(mem.teams))];
      const CT = {};
      for (const c of codes) { CT[c] = await C.project(c, { sims: SIMS }); if (opts.progress) opts.progress(Object.keys(CT).length / codes.length); }
      const T = [], confOf = {}, ix = {};
      codes.forEach(c => { const r = CT[c]; if (r) r.names.forEach(n => { ix[n] = T.length; T.push(n); confOf[n] = c; }); });
      const N = T.length;
      const W = T.map(n => CT[confOf[n]].proj[n].W), GN = T.map(n => CT[confOf[n]].proj[n].n || 1);
      const meanWP = T.map((n, i) => { let a = 0; for (let s = 0; s < SIMS; s++) a += W[i][s]; return a / SIMS / GN[i]; });
      const rating = T.map(n => sim.rate(n, rowOf[n]));          // preseason prior + results so far
      const confAvg = {}; codes.forEach(c => { const ns = T.filter(n => confOf[n] === c); confAvg[c] = ns.reduce((a, n) => a + rating[ix[n]], 0) / Math.max(1, ns.length); });
      const exemptConfs = codes.slice().sort((a, b) => confAvg[b] - confAvg[a]).slice(0, NIT.exempt_top_conferences || 10).concat(NIT.exempt_extra || []);
      // per team tallies
      const z = () => new Float64Array(N);
      const A = { ncaa: z(), auto: z(), atl: z(), ff: z(), r32: z(), s16: z(), e8: z(), f4: z(), final: z(), champ: z(), seedSum: z(),
        nit: z(), nitAuto: z(), nitQ: z(), nitSF: z(), nitF: z(), nitChamp: z(), sel: z(), lastIn: z(), firstOut: z() };
      const seedHist = Array.from({ length: N }, () => new Float64Array(17));
      const fwS = new Uint8Array(SIMS * N), restS = new Uint8Array(SIMS * N), confG = new Uint8Array(SIMS * N);
      const str = new Float64Array(N), sel = new Float64Array(N);
      const coin = (s, key) => sim.U(8, s, sim.hkey(key));
      const playN = (a, b, s, key) => { const m = sim.tame((str[a] - str[b]) * STRETCH), p = sim.phi(m / SIGMA); return coin(s, key) < p ? a : b; };
      const playH = (h, a, s, key) => {   // h hosts (NIT early rounds)
        const e = R.baseHca(rating[a]) + (rowOf[T[h]].hcaOff || 0);
        const m = sim.tame((str[h] - str[a]) * STRETCH + e), p = sim.phi(m / SIGMA); return coin(s, key) < p ? h : a; };

      for (let s = 0; s < SIMS; s++) {
        for (let i = 0; i < N; i++) {
          str[i] = rating[i] + sim.tau(T[i]) * sim.zTeam(s, T[i]);
          sel[i] = str[i] + RES * (W[i][s] / GN[i] - meanWP[i]);
          A.sel[i] += sel[i];
        }
        codes.forEach(c => { const r = CT[c]; if (!r) return; r.names.forEach((n, k) => { confG[s * N + ix[n]] = r.gamesS[s * r.names.length + k]; }); });
        // ── automatic bids ──
        const aq = [], inField = new Uint8Array(N);
        for (const c of codes) {
          const r = CT[c]; if (!r) continue;
          let pick = r.champS[s] >= 0 ? r.names[r.champS[s]] : null;
          // an ineligible champion: the league's bylaw — ASUN gives the bid to its regular-season champion,
          // most leagues (NEC: a semifinal-loser playoff, ≈ the runner-up) to the eligible runner-up
          const regChamp = () => r.names.filter(n => !INEL.has(n)).sort((a, b) => (r.proj[b].CW[s] - r.proj[a].CW[s]) || (sel[ix[b]] - sel[ix[a]]))[0];
          if (!pick || INEL.has(pick)) pick = (AQF[c] || AQF.default) === 'regular' ? regChamp()
            : (r.ruS[s] >= 0 && !INEL.has(r.names[r.ruS[s]]) ? r.names[r.ruS[s]] : null);
          if (!pick) pick = regChamp();
          if (pick) { aq.push(ix[pick]); inField[ix[pick]] = 1; A.auto[ix[pick]]++; }
        }
        // ── at-large ──
        const pool = []; for (let i = 0; i < N; i++) if (!inField[i] && !INEL.has(T[i])) pool.push(i);
        pool.sort((a, b) => sel[b] - sel[a]);
        const nAL = Math.max(0, FIELD - aq.length), atl = pool.slice(0, nAL);
        atl.forEach(i => { inField[i] = 1; A.atl[i]++; });
        if (atl.length) { A.lastIn[atl[atl.length - 1]]++; } if (pool[nAL] != null) A.firstOut[pool[nAL]]++;
        // ── First Four: lowest at-larges + lowest automatic qualifiers (by résumé) ──
        const alLow = atl.slice(-FF_AL), aqLow = aq.slice().sort((a, b) => sel[a] - sel[b]).slice(0, FF_AQ);
        const ffSet = new Set([...alLow, ...aqLow]);
        const entries = [];   // one per slot in the 64: {teams:[i] or [i,j] (a First Four pair), key sel}
        [...aq, ...atl].filter(i => !ffSet.has(i)).forEach(i => entries.push({ t: [i], k: sel[i], confs: [confOf[T[i]]] }));
        const pairUp = arr => { const a = arr.slice().sort((x, y) => sel[y] - sel[x]);
          for (let k = 0; k + 1 < a.length; k += 2) entries.push({ t: [a[k], a[k + 1]], k: sel[a[k]], confs: [confOf[T[a[k]]], confOf[T[a[k + 1]]]], ff: true }); };
        pairUp(alLow); pairUp(aqLow);
        entries.sort((a, b) => b.k - a.k);
        const regConf = [{}, {}, {}, {}];
        for (let line = 1; line <= 16; line++) {
          const L4 = entries.slice((line - 1) * 4, line * 4); L4.forEach(e => e.seed = line); placeLine(L4, line, regConf);
        }
        // play the First Four, then the regions
        const field = entries.slice(0, 64);
        field.forEach(e => { e.t.forEach(i => { A.ncaa[i]++; A.seedSum[i] += e.seed; seedHist[i][e.seed]++; if (e.ff) A.ff[i]++; }); });
        const fw = i => fwS[s * N + i]++, rest = i => restS[s * N + i]++;
        field.forEach((e, k) => { if (e.t.length === 2) { fw(e.t[0]); fw(e.t[1]); } e.w = e.t.length === 2 ? playN(e.t[0], e.t[1], s, 'ff' + k) : e.t[0]; });
        const regionChamps = [];
        for (let rg = 0; rg < 4; rg++) {
          const bySeed = {}; field.filter(e => e.region === rg).forEach(e => bySeed[e.seed] = e.w);
          let cur = SO.map(sd => bySeed[sd]).filter(x => x != null), rd = 0;
          while (cur.length > 1) {
            const nx = [];
            for (let k = 0; k + 1 < cur.length; k += 2) {
              const a = cur[k], b = cur[k + 1]; (rd < 2 ? fw : rest)(a); (rd < 2 ? fw : rest)(b);
              const w = playN(a, b, s, 'n' + rg + ':' + rd + ':' + k); nx.push(w);
            }
            cur = nx; rd++;
            const tally = [null, A.r32, A.s16, A.e8, A.f4][rd]; if (tally) cur.forEach(i => tally[i]++);
          }
          regionChamps.push(cur[0]);
        }
        const sf = [[regionChamps[0], regionChamps[1]], [regionChamps[2], regionChamps[3]]].map((m, k) => { rest(m[0]); rest(m[1]); return playN(m[0], m[1], s, 'f4' + k); });
        sf.forEach(i => A.final[i]++); rest(sf[0]); rest(sf[1]);
        A.champ[playN(sf[0], sf[1], s, 'nc')]++;
        // ── the NIT (2027 rules, 24 teams) ──
        // No. 1 seeds = the NCAA's first four out; exempt bids = the best team left out of each top league
        // (+ ACC, SEC); regular-season champions left out who rank 125th or better; then at-large
        const left = pool.slice(nAL);                 // eligible, not in the NCAA field, résumé order
        const rankOf = new Int16Array(N); { const all = [...Array(N).keys()].sort((a, b) => sel[b] - sel[a]); all.forEach((i, k) => rankOf[i] = k + 1); }
        const taken = new Uint8Array(N), nitIn = [], one = left.slice(0, 4);
        const add = (i, auto) => { if (i == null || taken[i] || nitIn.length >= NIT_N) return; taken[i] = 1; nitIn.push(i); if (auto) A.nitAuto[i]++; };
        one.forEach(i => add(i, true));
        exemptConfs.forEach(c => add(left.find(i => !taken[i] && confOf[T[i]] === c), true));
        codes.forEach(c => { const r = CT[c]; if (!r) return;
          const rc = r.names.slice().sort((a, b) => (r.proj[b].CW[s] - r.proj[a].CW[s]) || (sel[ix[b]] - sel[ix[a]]))[0], i = ix[rc];
          if (!inField[i] && !INEL.has(rc) && rankOf[i] <= (NIT.reg_champ_max_rank || 125)) add(i, true); });
        for (const i of left) { if (nitIn.length >= NIT_N) break; add(i, false); }
        nitIn.forEach(i => A.nit[i]++);
        // seeds: the four No. 1s, then the rest in résumé order four per line, snaked into four brackets of six
        const rest_ = nitIn.filter(i => !one.includes(i)).sort((a, b) => sel[b] - sel[a]);
        const brk = [0, 1, 2, 3].map(k => [one[k]]);
        rest_.forEach((i, k) => { const line = Math.floor(k / 4), pos = k % 4; brk[line % 2 ? 3 - pos : pos].push(i); });
        const seedN = {}; brk.forEach(b => b.forEach((i, k) => { if (i != null) seedN[i] = k + 1; }));
        const hostFirst = (a, b) => (seedN[a] < seedN[b] || (seedN[a] === seedN[b] && sel[a] >= sel[b])) ? [a, b] : [b, a];
        const pH = (a, b, key) => { if (a == null) return b; if (b == null) return a; const [h, v] = hostFirst(a, b); return playH(h, v, s, key); };
        const champsN = brk.map((b, bi) => {
          const [s1, s2, s3, s4, s5, s6] = b;
          const w45 = pH(s4, s5, 'nit' + bi + 'a'), w36 = pH(s3, s6, 'nit' + bi + 'b');
          const q1 = pH(s1, w45, 'nit' + bi + 'c'), q2 = pH(s2, w36, 'nit' + bi + 'd');
          [q1, q2].forEach(i => { if (i != null) A.nitQ[i]++; });
          return pH(q1, q2, 'nit' + bi + 'e');
        }).filter(i => i != null);
        champsN.forEach(i => A.nitSF[i]++);
        if (champsN.length === 4) {
          const fin = [pH(champsN[0], champsN[3], 'nitsf0'), pH(champsN[1], champsN[2], 'nitsf1')];   // semifinals on campus too
          fin.forEach(i => A.nitF[i]++); A.nitChamp[playN(fin[0], fin[1], s, 'nitf')]++;              // neutral final
        }
      }
      const teams = T.map((n, i) => {
        const k = SIMS, o = {};
        Object.keys(A).forEach(key => o[key] = A[key][i] / k);
        o.avgSeed = A.ncaa[i] ? A.seedSum[i] / A.ncaa[i] : null;
        o.seed = Array.from(seedHist[i]).map(v => v / k);
        o.team = n; o.conf = confOf[n]; o.row = rowOf[n]; o.ineligible = INEL.has(n); o.rate = rating[i];
        let cg = 0, f1 = 0, rr = 0; for (let s = 0; s < SIMS; s++) { cg += confG[s * N + i]; f1 += fwS[s * N + i]; rr += restS[s * N + i]; }
        o.confGames = cg / SIMS; o.fwGames = f1 / SIMS; o.restGames = rr / SIMS;
        return o;
      });
      const games = (full, s, which) => { const i = ix[full]; if (i == null) return 0; const a = which === 'conf' ? confG : which === 'fw' ? fwS : restS; return a[s * N + i]; };
      return { sims: SIMS, rules, field: FIELD, teams, byTeam: Object.fromEntries(teams.map(t => [t.team, t])), CT, games, n: N, idx: ix };
    })());
  }

  // the most likely bracket: AQ = each league's likeliest eligible tournament champion, at-large by
  // projected strength, the same First Four / S-curve / conference-separation rules as the simulation
  async function pointBracket() {
    const P = await run(); if (!P) return null;
    const NC = P.rules.ncaa || {}, FF_AL = (NC.first_four || {}).at_large_teams ?? 4, FF_AQ = (NC.first_four || {}).auto_teams ?? 4;
    const byConf = {}; P.teams.forEach(t => (byConf[t.conf] = byConf[t.conf] || []).push(t));
    const aq = Object.values(byConf).map(ts => ts.filter(t => !t.ineligible).sort((a, b) => (b.auto - a.auto) || (b.rate - a.rate))[0]).filter(Boolean);
    const aqSet = new Set(aq.map(t => t.team));
    const atl = P.teams.filter(t => !aqSet.has(t.team) && !t.ineligible).sort((a, b) => (b.sel) - (a.sel)).slice(0, P.field - aq.length);
    const key = t => t.sel;
    const alLow = atl.slice(-FF_AL), aqLow = aq.slice().sort((a, b) => key(a) - key(b)).slice(0, FF_AQ), ff = new Set([...alLow, ...aqLow].map(t => t.team));
    const entries = [...aq, ...atl].filter(t => !ff.has(t.team)).map(t => ({ t: [t], k: key(t), confs: [t.conf] }));
    const pairUp = arr => { const a = arr.slice().sort((x, y) => key(y) - key(x)); for (let k = 0; k + 1 < a.length; k += 2) entries.push({ t: [a[k], a[k + 1]], k: key(a[k]), confs: [a[k].conf, a[k + 1].conf], ff: true }); };
    pairUp(alLow); pairUp(aqLow);
    entries.sort((a, b) => b.k - a.k);
    const regConf = [{}, {}, {}, {}];
    for (let line = 1; line <= 16; line++) { const L4 = entries.slice((line - 1) * 4, line * 4); L4.forEach(e => e.seed = line); placeLine(L4, line, regConf); }
    const firstOut = P.teams.filter(t => !aqSet.has(t.team) && !t.ineligible && !atl.includes(t)).sort((a, b) => b.sel - a.sel).slice(0, 8);
    return { entries: entries.slice(0, 64), regions: REGIONS, aq: aqSet, lastIn: atl.slice(-8), firstOut, P };
  }

  // the most likely bracket as a list of game objects (the shape bracket.html / tournaments.html render):
  // the seeded field from pointBracket(), every game projected to the stronger team after the
  // team_dna style-matchup edge (a couple of points on a real mismatch — flips close games, never a 1 seed)
  let _games = null;
  async function projectedGames() {
    if (_games) return _games;
    const B = await pointBracket(); if (!B) return null;
    let dna = {}; try { dna = ((await fetch('scripts/data/team_dna.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : {}))['2027'] || {}).teams || {}; } catch (e) {}
    const LG = { oeFG: 53.0, deFG: 48.4, oTOV: 15.1, dTOV: 17.8, oORB: 31.2, dDRB: 73.2 };
    const num = (o, k) => { const v = o && o[k]; return (typeof v === 'number' && isFinite(v)) ? v : null; };
    const exploit = (o, d) => { let s = 0, ok = false;
      const oE = num(o, 'oeFG'), oT = num(o, 'oTOV'), oO = num(o, 'oORB'), dE = num(d, 'deFG'), dT = num(d, 'dTOV'), dD = num(d, 'dDRB');
      if (oE != null && dE != null) { s += 0.115 * ((oE - LG.oeFG) * (dE - LG.deFG)); ok = true; }
      if (oT != null && dT != null) { s += 0.088 * ((LG.oTOV - oT) * (LG.dTOV - dT)); ok = true; }
      if (oO != null && dD != null) { s += 0.054 * ((oO - LG.oORB) * (LG.dDRB - dD)); ok = true; }
      return ok ? s : 0; };
    const edge = (a, b) => { const da = dna[a.full], db = dna[b.full]; if (!da || !db) return 0; return Math.max(-4, Math.min(4, exploit(da, db) - exploit(db, da))); };
    const D = (B.P.rules.ncaa || {}).dates || {};
    const DT = { open: D.first_four || '2027-03-16', r1: D.first_round || '2027-03-18', r2: D.second_round || '2027-03-20', s16: D.sweet16 || '2027-03-25',
      e8: D.elite8 || '2027-03-27', ff: D.final_four || '2027-04-03', nc: D.championship || '2027-04-05' };
    const T = t => ({ full: t.team, team: (t.row && t.row.team) || t.team, conf: t.conf, rating: t.rate, rank: t.row && t.row.rank, _seed: null });
    const proj = (a, b) => ((a.rating - b.rating) + edge(a, b)) >= 0 ? a : b;
    let gid = 920000000; const games = [];
    const mk = (a, b, round, rord, region, date) => { const w = proj(a, b);
      return { id: gid++, season: 2027, date, category: 'NCAA', tournament: 'NCAA Tournament (Projected)', round, round_order: rord, division: region, neutral: true, _proj: true, notable: true,
        home: a.full, home_id: a.full, home_score: null, home_seed: a._seed, _hr: a.rating, away: b.full, away_id: b.full, away_score: null, away_seed: b._seed, _ar: b.rating,
        winner: w.full, winner_id: w.full }; };
    const regionNames = REGIONS.map(r => r + ' Region'), slots = [[], [], [], []];
    B.entries.forEach(e => {
      let x;
      if (e.t.length === 2) { const a = T(e.t[0]), b = T(e.t[1]); a._seed = b._seed = e.seed; games.push(mk(a, b, 'Opening Round', 0, null, DT.open)); x = proj(a, b); x._ff = true; }
      else { x = T(e.t[0]); }
      x._seed = e.seed; slots[e.region].push(x);
    });
    const champs = [];
    slots.forEach((rt, ri) => {
      const by = {}; rt.forEach(t => by[t._seed] = t); const region = regionNames[ri];
      let cur = []; for (let i = 0; i < 16; i += 2) { const a = by[SO[i]], b = by[SO[i + 1]]; if (!a || !b) continue; games.push(mk(a, b, '1st Round', 1, region, DT.r1)); cur.push(proj(a, b)); }
      const nextR = (arr, round, rord, date) => { const nx = []; for (let i = 0; i + 1 < arr.length; i += 2) { games.push(mk(arr[i], arr[i + 1], round, rord, region, date)); nx.push(proj(arr[i], arr[i + 1])); } return nx; };
      const r2 = nextR(cur, '2nd Round', 2, DT.r2), s16 = nextR(r2, 'Sweet 16', 3, DT.s16); nextR(s16, 'Elite Eight', 4, DT.e8);
      champs.push(proj(s16[0], s16[1]));
    });
    games.push(mk(champs[0], champs[1], 'Final Four', 5, null, DT.ff)); games.push(mk(champs[2], champs[3], 'Final Four', 5, null, DT.ff));
    games.push(mk(proj(champs[0], champs[1]), proj(champs[2], champs[3]), 'National Championship', 6, null, DT.nc));
    const srs = {}; B.P.teams.forEach(t => srs[t.team] = t.rate);
    return (_games = { games, srs, bracket: B });
  }

  g.TDCPost = { run, pointBracket, projectedGames, REGIONS, SO, loadRules };
})(typeof window !== 'undefined' ? window : globalThis);
