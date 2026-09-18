/* tdc-preview.js — game preview for a scheduled 2026-27 game.
 *
 * TDCPreview.render(host, {team, opp, date})   team/opp = full names (ratings spelling)
 *
 * Pulls the game's line from the schedule simulation (tdc-schedule.js), lays the two
 * teams side by side (rating, rank, projected offense / defense / tempo, four factors),
 * then projects every rotation player's stat line FOR THIS GAME:
 *
 *   base line   the player's 2026-27 projection (stat_overall_projected.json; freshmen
 *               from the owner's freshman profiles via tdc-freshman.js)
 *   pace        × expected possessions ÷ the team's own tempo   (fast game → more of everything)
 *   defense     scoring × how this offense prices against THIS defense (ORtg + oppDRtg − avg)/ORtg;
 *               assists half of that; shooting % moves with the square root
 *   blowout     starters lose minutes once the spread passes ~12
 *   coherence   the roster's points are scaled so they add up to the projected team score
 */
(function (g) {
  const SB = 'https://izlqhnxowdhtdofkwrho.supabase.co', KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
  const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
  let _eff = null, _proj = null, _effP = null, _projP = null;
  const sn = x => (g.tdcShortSchool ? g.tdcShortSchool(x) : x) || x;
  const logo = n => { try { const r = g.tdcTeamColor && g.tdcTeamColor(n); return r && r.logo || ''; } catch (e) { return ''; } };
  const col = n => { try { const r = g.tdcTeamColor && g.tdcTeamColor(n); return r && r.c1 || '#888'; } catch (e) { return '#888'; } };
  const sg = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1);
  const f1 = v => v == null || !isFinite(v) ? '—' : (+v).toFixed(1);

  function loadEff() { return _effP || (_effP = fetch('scripts/data/team_pace_eff.json?v=2').then(r => r.ok ? r.json() : null).then(j => (_eff = j)).catch(() => null)); }
  function loadProj() { return _projP || (_projP = fetch('scripts/data/stat_overall_projected.json?v=34').then(r => r.ok ? r.json() : null).then(j => (_proj = j)).catch(() => null)); }
  function roster(full) {
    const short = sn(full);
    return fetch(`${SB}/rest/v1/players?team=eq.${encodeURIComponent(short)}&select=name,team,position,class_year,height,espn_id,tdc_grade,ppg,rpg,apg,mpg,fg_pct,tp_pct,three_pct,ft_pct,stl,blk,tovs,fga,fgm,tpa,tpm,is_injured,yr,starter,depth_order&order=depth_order.asc.nullslast`, { headers: H })
      .then(r => r.ok ? r.json() : []).catch(() => []);
  }

  // ── player lines ──────────────────────────────────────────────────────────
  function baseLine(p) {
    const P = _proj && _proj.players;
    const mk = (src, q, ovr) => {
      const n = k => (q[k] == null || q[k] === '' ? null : +q[k]);
      const b = { src, ovr, mpg: n('mpg'), ppg: n('ppg'), rpg: n('rpg'), apg: n('apg'), fg: n('fg_pct'), tp: n('tp_pct') != null ? n('tp_pct') : n('three_pct'), ft: n('ft_pct'),
        stl: n('stl') || 0, blk: n('blk') || 0, tov: n('tovs') || 0, fga: n('fga'), fgm: n('fgm'), tpa: n('tpa'), tpm: n('tpm'), fta: n('fta'), ftm: n('ftm'), oreb: n('oreb'), dreb: n('dreb') };
      // fill shot components when a line only carries the headline numbers
      if (b.fga == null && b.ppg != null) { const pct = (b.fg || 44) / 100; b.fga = b.ppg * 0.42 / Math.max(0.3, pct) * 0.9; b.fgm = b.fga * pct; }
      if (b.tpa == null) { b.tpa = (b.fga || 0) * 0.36; b.tpm = b.tpa * ((b.tp || 33) / 100); }
      if (b.fta == null) { b.fta = (b.fga || 0) * 0.3; b.ftm = b.fta * ((b.ft || 70) / 100); }
      if (b.oreb == null && b.rpg != null) { b.oreb = b.rpg * 0.28; b.dreb = b.rpg - b.oreb; }
      return b;
    };
    if (P && p.espn_id && P[String(p.espn_id)]) { const q = P[String(p.espn_id)]; return mk('proj', q, q.ovr); }
    if (g.TDCFresh && g.TDCFresh.isFreshman && g.TDCFresh.isFreshman(p)) {
      try { const l = g.TDCFresh.line(p, g.TDCFresh.profileFor(p)); if (l && l.mpg) return mk('fresh', l, l._frOvr || p.tdc_grade); } catch (e) {}
    }
    if (p.mpg && p.ppg != null) return mk('last', p, p.tdc_grade);
    return null;
  }

  // one team's lines for this game. E = pace/eff record for the team, O = for the opponent
  function teamLines(players, E, O, ctx) {
    const avgD = _eff ? _eff.avgD : 102.7;
    const paceK = ctx.pace && E && E.t ? ctx.pace / E.t : 1;
    const offK = E && O ? (E.o + O.d - avgD) / E.o : 1;            // this offense vs this defense, relative to its norm
    const spread = Math.abs(ctx.margin || 0), starterK = Math.max(0.8, 1 - 0.01 * Math.max(0, spread - 12));
    // rebounds / turnovers vs THIS opponent: their defensive-board and turnover-forcing rates against the D-I norm
    const ff = _eff && _eff.ffAvg || {}, of = O && O.ff || {};
    const orbK = of.dDRB != null && ff.dDRB ? (100 - of.dDRB) / (100 - ff.dDRB) : 1;      // opp's DREB% leaves fewer/more offensive boards
    const drbK = of.oORB != null && ff.oORB ? (100 - of.oORB) / (100 - ff.oORB) : 1;      // opp's OREB% eats into our defensive boards
    const tovK = of.dTOV != null && ff.dTOV ? of.dTOV / ff.dTOV : 1;                        // opp forces turnovers above/below the norm
    const out = p => p.is_injured || (g.TDCInjury && g.TDCInjury.isOut(p));
    let rows = players.filter(p => !out(p)).map(p => ({ p, b: baseLine(p) })).filter(x => x.b && x.b.mpg >= 6);
    rows.sort((a, b) => b.b.mpg - a.b.mpg);
    rows = rows.slice(0, 11);
    // a game has 200 minutes; season projections drawn up independently can add to more
    const rawMin = rows.reduce((s, x) => s + x.b.mpg, 0), fitK = rawMin > 205 ? 200 / rawMin : 1;
    rows.forEach((x, i) => {
      const b = x.b, minK = (i < 5 ? starterK : 1 + (1 - starterK) * 0.6) * fitK;
      const min = Math.min(38, b.mpg * minK), vol = paceK * minK;
      const fgp = Math.min(75, (b.fg || 44) * Math.sqrt(offK)), tpp = Math.min(60, (b.tp || 33) * Math.sqrt(offK)), ftp = b.ft || 70;
      const fga = (b.fga || 0) * vol, tpa = Math.min(fga, (b.tpa || 0) * vol), fta = (b.fta || 0) * vol;
      // makes from the matchup-adjusted percentages; twos and threes keep their own rates
      const tpm = tpa * tpp / 100, twoA = fga - tpa, twoP = fga > 0 && b.fgm != null && b.tpm != null && twoA > 0 ? Math.min(0.8, Math.max(0.3, (b.fgm - b.tpm) / Math.max(0.1, (b.fga - b.tpa)))) * Math.sqrt(offK) : fgp / 100;
      const fgm = tpm + twoA * twoP, ftm = fta * ftp / 100;
      const oreb = (b.oreb || 0) * vol * orbK, dreb = (b.dreb || 0) * vol * drbK;
      x.l = { min, fga, fgm, tpa, tpm, fta, ftm, oreb, dreb, reb: oreb + dreb, ast: (b.apg || 0) * vol * Math.sqrt(offK),
        stl: b.stl * vol, blk: b.blk * vol, tov: b.tov * vol * tovK, pts: 2 * (fgm - tpm) + 3 * tpm + ftm };
    });
    // coherence: the rotation's points add up to the projected team score (only when the roster is
    // reasonably complete — a missing star would otherwise inflate everyone else)
    const sumMin = rows.reduce((s, x) => s + x.l.min, 0), sumPts = rows.reduce((s, x) => s + x.l.pts, 0);
    let scaleK = 1;
    if (ctx.score && sumMin >= 170 && sumPts > 0) scaleK = Math.max(0.8, Math.min(1.25, ctx.score / sumPts));
    rows.forEach(x => { ['pts', 'fga', 'fgm', 'tpa', 'tpm', 'fta', 'ftm'].forEach(k => { x.l[k] *= scaleK; }); x.l.dPts = x.l.pts - (x.b.ppg || 0); });
    return { rows, paceK, offK, starterK, scaleK, sumMin };
  }

  // ── render ────────────────────────────────────────────────────────────────
  const CSS = `
  .gp{font-family:'Inter',system-ui,sans-serif;}
  .gp-hero{display:grid;grid-template-columns:1fr auto 1fr;gap:18px;align-items:center;padding:22px 24px;border:1px solid var(--border);border-radius:16px;background:linear-gradient(120deg,#0B1220 0%,#121C33 55%,#1A2A4C 100%);color:#fff;margin-bottom:14px;}
  .gp-side{display:flex;align-items:center;gap:14px;min-width:0;}
  .gp-side.r{flex-direction:row-reverse;text-align:right;}
  .gp-side img{width:64px;height:64px;object-fit:contain;filter:drop-shadow(0 6px 14px rgba(0,0,0,.35));}
  .gp-nm{font-family:'Playfair Display',serif;font-weight:800;font-size:26px;line-height:1.05;}
  .gp-nm a{color:inherit;text-decoration:none;}
  .gp-sub{font-size:12px;color:rgba(255,255,255,.6);margin-top:4px;font-weight:600;}
  .gp-sub b{color:#E6D5A8;}
  .gp-mid{text-align:center;min-width:170px;}
  .gp-score{font-family:'Playfair Display',serif;font-weight:800;font-size:38px;line-height:1;letter-spacing:-.02em;}
  .gp-when{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#E6D5A8;margin-bottom:8px;}
  .gp-odds{font-size:12.5px;color:rgba(255,255,255,.75);margin-top:8px;font-weight:600;}
  .gp-odds b{color:#fff;}
  .gp-strip{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-bottom:16px;}
  .gp-tile{border:1px solid var(--border);border-radius:10px;padding:9px 12px 8px;background:var(--bg2);}
  .gp-tile .k{font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);margin-bottom:3px;white-space:nowrap;}
  .gp-tile .v{font-family:'Playfair Display',serif;font-weight:800;font-size:20px;line-height:1;color:var(--text);}
  .gp-tile .s{font-size:10.5px;color:var(--text3);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .gp-h{font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--text2);padding:10px 14px;background:var(--bg2);border:1px solid var(--border);border-radius:12px 12px 0 0;border-bottom:none;margin-top:16px;display:flex;align-items:center;gap:10px;}
  .gp-h::before{content:'';width:6px;height:6px;border-radius:2px;background:var(--accent);}
  .gp-h span{margin-left:auto;font-weight:600;letter-spacing:0;text-transform:none;color:var(--text3);}
  .gp-wrap{border:1px solid var(--border);border-radius:0 0 12px 12px;overflow:auto;background:var(--bg);}
  .gp-t{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums;}
  .gp-t th{font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);padding:7px 12px;border-bottom:1px solid var(--border);text-align:right;white-space:nowrap;background:var(--bg2);}
  .gp-t th.l,.gp-t td.l{text-align:left;}
  .gp-t td{padding:6px 12px;border-bottom:1px solid color-mix(in srgb,var(--border) 70%,transparent);text-align:right;color:var(--text2);white-space:nowrap;}
  .gp-t tr:last-child td{border-bottom:none;}
  .gp-t td.nm{font-weight:700;color:var(--text);}
  .gp-t td.nm a{color:inherit;text-decoration:underline dotted;text-underline-offset:3px;text-decoration-color:color-mix(in srgb,var(--text3) 60%,transparent);} .gp-t td.nm a:hover{color:var(--accent);text-decoration-color:var(--accent);}
  .gp-t td.nm small{font-weight:600;color:var(--text3);margin-left:6px;font-size:11px;}
  .gp-t td.w{color:var(--text);font-weight:800;background:color-mix(in srgb,var(--side) 14%,transparent);}
  .gp-t td.big{font-weight:800;color:var(--text);}
  .gp-t td.pos{color:#2f9159;} .gp-t td.neg{color:#d05a5a;}
  [data-theme="dark"] .gp-t td.pos{color:#4fc07a;} [data-theme="dark"] .gp-t td.neg{color:#ef6e6e;}
  .gp-t td.tot{font-weight:800;color:var(--text);background:var(--bg2);}
  .gp-two{display:grid;grid-template-columns:1fr;gap:18px;}
  .gp-inj{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;font-size:11.5px;color:var(--text2);padding:8px 4px 0;}
  .gp-inj-l{font-size:9.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);}
  .gp-inj-out{color:#d05a5a;} .gp-inj-hurt{color:var(--text2);} .gp-inj b{font-weight:700;color:var(--text);}
  [data-theme="dark"] .gp-inj-out{color:#ef6e6e;}
  .gp-note{font-size:11.5px;color:var(--text3);line-height:1.5;margin:10px 2px 0;}
  .gp-note b{color:var(--text2);}
  .gp-empty{padding:16px 14px;font-size:12.5px;color:var(--text3);}
  @media(max-width:860px){.gp-strip{grid-template-columns:repeat(2,minmax(0,1fr));}.gp-hero{grid-template-columns:1fr;text-align:center;}.gp-side,.gp-side.r{flex-direction:column;text-align:center;}}`;
  function ensureCss() { if (document.getElementById('gp-css')) return; const s = document.createElement('style'); s.id = 'gp-css'; s.textContent = CSS; document.head.appendChild(s); }

  const teamHref = n => `team.html?team=${encodeURIComponent(sn(n))}`;
  const playerHref = (p, team) => `player.html?name=${encodeURIComponent(p.name)}&team=${encodeURIComponent(sn(team))}`;

  function cmpTable(A, B, EA, EB, RA, RB) {
    const ff = _eff && _eff.ffAvg || {};
    const rows = [
      ['Power Rating', RA && RA.rating, RB && RB.rating, v => sg(v), true],
      ['Nat\'l rank', RA && RA.rank, RB && RB.rank, v => '#' + v, false],
      ['Proj ORtg', EA && EA.o, EB && EB.o, f1, true], ['Proj DRtg', EA && EA.d, EB && EB.d, f1, false], ['Tempo', EA && EA.t, EB && EB.t, f1, null],
      ['eFG%', EA && EA.ff && EA.ff.oeFG, EB && EB.ff && EB.ff.oeFG, f1, true], ['TOV%', EA && EA.ff && EA.ff.oTOV, EB && EB.ff && EB.ff.oTOV, f1, false],
      ['OREB%', EA && EA.ff && EA.ff.oORB, EB && EB.ff && EB.ff.oORB, f1, true], ['FT rate', EA && EA.ff && EA.ff.oFTr, EB && EB.ff && EB.ff.oFTr, f1, true],
      ['Opp eFG%', EA && EA.ff && EA.ff.deFG, EB && EB.ff && EB.ff.deFG, f1, false], ['Forced TOV%', EA && EA.ff && EA.ff.dTOV, EB && EB.ff && EB.ff.dTOV, f1, true],
      ['DREB%', EA && EA.ff && EA.ff.dDRB, EB && EB.ff && EB.ff.dDRB, f1, true],
    ];
    const ca = col(A), cb = col(B);
    return `<div class="gp-wrap"><table class="gp-t"><thead><tr><th class="l" style="min-width:170px"></th><th>${sn(A)}</th><th>${sn(B)}</th><th>D-I avg</th></tr></thead><tbody>${rows.map(([l, a, b, f, hi]) => {
      const ha = a != null && isFinite(a), hb = b != null && isFinite(b);
      let wa = '', wb = '';
      if (hi !== null && ha && hb && a !== b) { const aw = hi ? a > b : a < b; wa = aw ? 'w' : ''; wb = aw ? '' : 'w'; }
      const avg = { 'eFG%': ff.oeFG, 'TOV%': ff.oTOV, 'OREB%': ff.oORB, 'FT rate': ff.oFTr, 'Opp eFG%': ff.deFG, 'Forced TOV%': ff.dTOV, 'DREB%': ff.dDRB, 'Proj ORtg': _eff && _eff.avgO, 'Proj DRtg': _eff && _eff.avgD, 'Tempo': _eff && _eff.avgT }[l];
      return `<tr><td class="l">${l}</td><td class="${wa}" style="--side:${ca}">${ha ? f(a) : '—'}</td><td class="${wb}" style="--side:${cb}">${hb ? f(b) : '—'}</td><td style="color:var(--text3)">${avg != null ? f1(avg) : ''}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function playersTable(team, T, color) {
    if (!T || !T.rows.length) return `<div class="gp-wrap"><div class="gp-empty">No projected lines on file for ${sn(team)}'s roster yet.</div></div>`;
    const K = ['min', 'pts', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'oreb', 'dreb', 'reb', 'ast', 'tov'];
    const tot = T.rows.reduce((s, x) => { K.forEach(k => { s[k] += x.l[k] || 0; }); return s; }, Object.fromEntries(K.map(k => [k, 0])));
    const cls = v => v > 0.4 ? 'pos' : v < -0.4 ? 'neg' : '';
    const ma = (m, a) => `${m.toFixed(1)}–${a.toFixed(1)}`, pct = (m, a) => a > 0 ? (100 * m / a).toFixed(1) : '—';
    return `<div class="gp-wrap"><table class="gp-t"><thead><tr><th class="l">Player</th><th>Min</th><th>Pts</th><th title="field goals made–attempted">FG</th><th title="threes made–attempted">3P</th><th title="free throws made–attempted">FT</th><th title="offensive rebounds">OR</th><th title="defensive rebounds">DR</th><th>Reb</th><th>Ast</th><th>TO</th><th title="points vs the player's season projection">vs avg</th></tr></thead><tbody>${T.rows.map(x => {
      const p = x.p, l = x.l;
      return `<tr><td class="l nm"><a href="${playerHref(p, team)}">${p.name}</a><small>${p.position || ''}${p.class_year ? ' · ' + p.class_year : ''}${x.b.src === 'fresh' ? ' · Fr proj' : x.b.src === 'last' ? ' · last yr' : ''}</small></td>
        <td>${l.min.toFixed(0)}</td><td class="big">${l.pts.toFixed(1)}</td><td>${ma(l.fgm, l.fga)}</td><td>${ma(l.tpm, l.tpa)}</td><td>${ma(l.ftm, l.fta)}</td><td>${l.oreb.toFixed(1)}</td><td>${l.dreb.toFixed(1)}</td><td>${l.reb.toFixed(1)}</td><td>${l.ast.toFixed(1)}</td><td>${l.tov.toFixed(1)}</td><td class="${cls(l.dPts)}">${sg(l.dPts)}</td></tr>`;
    }).join('')}<tr><td class="l tot">Team</td><td class="tot">${tot.min.toFixed(0)}</td><td class="tot">${tot.pts.toFixed(0)}</td><td class="tot">${ma(tot.fgm, tot.fga)}<small style="color:var(--text3);margin-left:4px">${pct(tot.fgm, tot.fga)}%</small></td><td class="tot">${ma(tot.tpm, tot.tpa)}<small style="color:var(--text3);margin-left:4px">${pct(tot.tpm, tot.tpa)}%</small></td><td class="tot">${ma(tot.ftm, tot.fta)}</td><td class="tot">${tot.oreb.toFixed(1)}</td><td class="tot">${tot.dreb.toFixed(1)}</td><td class="tot">${tot.reb.toFixed(1)}</td><td class="tot">${tot.ast.toFixed(1)}</td><td class="tot">${tot.tov.toFixed(1)}</td><td class="tot"></td></tr></tbody></table></div>`;
  }

  async function render(host, opts) {
    ensureCss();
    const team = opts.team, opp = opts.opp, date = opts.date;
    host.innerHTML = '<div class="gp-empty">Building the preview…</div>';
    const [R, E, D] = await Promise.all([g.TDCSched ? g.TDCSched.project(team).catch(() => null) : null, loadEff(), g.TDC_RATINGS ? g.TDC_RATINGS.get() : null, loadProj(),
      g.TDCFresh && g.TDCFresh.load ? g.TDCFresh.load().catch(() => null) : null]);
    const row = R && R.rows.find(r => r.g.date === date && (r.oppName === opp || !r.oppName)) || (R && R.rows.find(r => r.oppName === opp));
    if (!row) { host.innerHTML = `<div class="gp-empty">No projected game between ${sn(team)} and ${sn(opp)} on ${date} in the announced schedule.</div>`; return; }
    const rowOf = n => D && D.teams.find(t => t.full === n) || null;
    const RA = rowOf(team), RB = row.oppName ? rowOf(row.oppName) : null;
    const EA = E && E.teams[team] || null, EB = E && row.oppName && E.teams[row.oppName] || null;
    const oppName = row.oppName || row.label;
    // hero: home team on the left, like a scoreboard
    const homeIsTeam = row.venue !== 'A';
    const L = homeIsTeam ? { n: team, sc: row.scoreMe, r: RA } : { n: oppName, sc: row.scoreOpp, r: RB };
    const Rt = homeIsTeam ? { n: oppName, sc: row.scoreOpp, r: RB } : { n: team, sc: row.scoreMe, r: RA };
    const d = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const pc = Math.round(row.p * 100);
    const side = (x, right) => `<div class="gp-side${right ? ' r' : ''}">${logo(x.n) ? `<img src="${logo(x.n)}" alt="">` : ''}<div><div class="gp-nm">${row.oppName || x.n === team ? `<a href="${teamHref(x.n)}">${sn(x.n)}</a>` : x.n}</div><div class="gp-sub">${x.r ? `<b>#${x.r.rank}</b> · ${sg(x.r.rating)} · ${x.r.conf || ''}` : 'unrated'}</div></div></div>`;
    const hero = `<div class="gp-hero">${side(L, false)}<div class="gp-mid"><div class="gp-when">${d}${row.venue === 'N' ? ' · Neutral' : ''}${row.event ? ' · ' + row.event : ''}</div><div class="gp-score">${L.sc}–${Rt.sc}</div><div class="gp-odds"><b>${sn(team)}</b> ${pc}% to win · line ${row.margin >= 0 ? '−' : '+'}${Math.abs(row.margin).toFixed(1)}</div></div>${side(Rt, true)}</div>`;
    const strip = `<div class="gp-strip">
      <div class="gp-tile"><div class="k">Win prob</div><div class="v">${pc}%</div><div class="s">${sn(team)} · ${Math.round(row.p0 * 100)}% on the line alone</div></div>
      <div class="gp-tile"><div class="k">Line</div><div class="v">${row.margin >= 0 ? sn(team) + ' −' + row.margin.toFixed(1) : sn(oppName) + ' −' + (-row.margin).toFixed(1)}</div><div class="s">projected margin</div></div>
      <div class="gp-tile"><div class="k">Total</div><div class="v">${row.total ? row.total.toFixed(1) : '—'}</div><div class="s">${row.pace ? row.pace + ' possessions' : 'league-average pace'}</div></div>
      <div class="gp-tile"><div class="k">Site</div><div class="v">${row.venue === 'H' ? 'Home' : row.venue === 'A' ? 'Away' : 'Neutral'}</div><div class="s">${row.venuePts ? 'venue edge ' + sg(row.venuePts) : 'no venue edge'}</div></div>
      <div class="gp-tile"><div class="k">Rest</div><div class="v">${row.mf.rest == null ? 'Opener' : row.mf.rest <= 1 ? 'B2B' : row.mf.rest + 'd'}</div><div class="s">${row.known ? 'vs ' + (row.of.rest == null ? 'opener' : row.of.rest <= 1 ? 'b2b' : row.of.rest + 'd') : 'opponent unknown'}${Math.abs(row.sit) >= 0.15 ? ' · ' + sg(row.sit) + ' pts' : ''}</div></div>
    </div>`;
    host.innerHTML = hero + `<div id="gpMatch" style="border-radius:12px;">${strip}<div class="gp-h">Matchup <span>projected 2026-27 profiles · D-I average for scale</span></div><div id="gpCmp">${cmpTable(team, oppName, EA, EB, RA, RB)}</div></div><div id="gpPlayers" style="border-radius:12px;"><div class="gp-h">Projected lines · this game</div><div class="gp-wrap"><div class="gp-empty">Loading rosters…</div></div></div>`;
    // tiers: the headline (score, odds, line) is free; the matchup profile is Premium; the
    // per-player game projections are Pro (Coach's Tier and Betting Lab members included)
    const gate = () => { if (!g.TDCGate) return;
      g.TDCGate.lock(document.getElementById('gpMatch'), { tier: 'premium', label: 'the matchup profile', blurb: 'Premium members see the full matchup — projected efficiency, tempo, four factors and the situational edges behind the line.' });
      g.TDCGate.lock(document.getElementById('gpPlayers'), { tier: 'pro', label: 'projected player lines', blurb: 'Pro, Coach\'s Tier and Betting Lab members see how every rotation player projects in this specific matchup — minutes, points, rebounds, assists and shooting.' }); };
    if (g.TDCGate) { if (g.TDCGate.resolved && g.TDCGate.resolved()) gate(); else if (g.TDCGate.ready) g.TDCGate.ready.then(gate); }
    // players
    const ctx = { pace: row.pace, score: row.scoreMe, margin: row.margin };
    const [pa, pb] = await Promise.all([roster(team), row.oppName ? roster(row.oppName) : Promise.resolve([])]);
    const TA = teamLines(pa, EA, EB, ctx), TB = row.oppName ? teamLines(pb, EB, EA, { pace: row.pace, score: row.scoreOpp, margin: -row.margin }) : null;
    // team shot split for THIS game (the rotations' totals) — appended to the matchup table
    const totOf = T => T && T.rows.length ? T.rows.reduce((s, x) => { ['fga', 'fgm', 'tpa', 'tpm', 'fta', 'ftm', 'oreb', 'dreb', 'tov', 'ast'].forEach(k => { s[k] += x.l[k] || 0; }); return s; }, { fga: 0, fgm: 0, tpa: 0, tpm: 0, fta: 0, ftm: 0, oreb: 0, dreb: 0, tov: 0, ast: 0 }) : null;
    const ta = totOf(TA), tb = totOf(TB);
    if (ta || tb) {
      const ma = t => `${t.tpm.toFixed(1)}–${t.tpa.toFixed(1)}`;
      const shot = [
        ['3PA · 3PM', t => `${t.tpa.toFixed(1)} att · ${t.tpm.toFixed(1)} made <small style="color:var(--text3)">${t.tpa ? (100 * t.tpm / t.tpa).toFixed(0) : 0}%</small>`, t => t.tpm, true],
        ['3PA share', t => `${t.fga ? (100 * t.tpa / t.fga).toFixed(0) : 0}% of shots`, t => t.tpa / (t.fga || 1), null],
        ['2PA · 2PM', t => `${(t.fga - t.tpa).toFixed(1)} att · ${(t.fgm - t.tpm).toFixed(1)} made <small style="color:var(--text3)">${(t.fga - t.tpa) ? (100 * (t.fgm - t.tpm) / (t.fga - t.tpa)).toFixed(0) : 0}%</small>`, t => t.fgm - t.tpm, true],
        ['FTA · FTM', t => `${t.fta.toFixed(1)} att · ${t.ftm.toFixed(1)} made`, t => t.ftm, true],
        ['Off. rebounds', t => t.oreb.toFixed(1), t => t.oreb, true], ['Def. rebounds', t => t.dreb.toFixed(1), t => t.dreb, true],
        ['Assists', t => t.ast.toFixed(1), t => t.ast, true], ['Turnovers', t => t.tov.toFixed(1), t => t.tov, false],
      ];
      const ca = col(team), cb = col(oppName);
      const rowsHtml = `<tr><td class="l" colspan="4" style="font-size:9.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);background:var(--bg2);padding:6px 12px;">Projected shot split · this game</td></tr>` + shot.map(([l, f, v, hi]) => {
        const a = ta ? v(ta) : null, b = tb ? v(tb) : null; let wa = '', wb = '';
        if (hi !== null && a != null && b != null && a !== b) { const aw = hi ? a > b : a < b; wa = aw ? 'w' : ''; wb = aw ? '' : 'w'; }
        return `<tr><td class="l">${l}</td><td class="${wa}" style="--side:${ca}">${ta ? f(ta) : '—'}</td><td class="${wb}" style="--side:${cb}">${tb ? f(tb) : '—'}</td><td></td></tr>`;
      }).join('');
      const tbody = document.querySelector('#gpCmp .gp-t tbody'); if (tbody) tbody.insertAdjacentHTML('beforeend', rowsHtml);
    }
    const note = (T, n) => T && T.rows.length ? `${sn(n)}: pace ×${T.paceK.toFixed(2)} · vs this defense ×${T.offK.toFixed(2)}${T.starterK < 1 ? ` · starters' minutes ×${T.starterK.toFixed(2)} (blowout)` : ''}${Math.abs(T.scaleK - 1) > 0.005 ? ` · scaled ×${T.scaleK.toFixed(2)} to the team score` : ''}` : '';
    // injury report: out (removed from the rotation above) and hurt-but-playing, from the owner's injury tool + roster flags
    const injLine = (players, n) => {
      if (!players || !players.length) return '';
      const I = g.TDCInjury;
      const outs = players.filter(p => p.is_injured || (I && I.isOut(p))).map(p => { const r = I && I.get(p); return `<b>${p.name}</b>${r ? ` (${r.part} · ${I.statusLabel(r).split(' · ')[1] || ''})` : ' (out)'}`; });
      const hurt = players.filter(p => I && I.get(p) && !I.isOut(p)).map(p => { const r = I.get(p); return `<b>${p.name}</b> (${r.part} · ${I.statusLabel(r).split(' · ')[1] || ''})`; });
      if (!outs.length && !hurt.length) return '';
      return `<div class="gp-inj"><span class="gp-inj-l">${sn(n)} injuries</span>${outs.length ? `<span class="gp-inj-out">Out: ${outs.join(', ')}</span>` : ''}${hurt.length ? `<span class="gp-inj-hurt">Playing hurt: ${hurt.join(', ')}</span>` : ''}</div>`;
    };
    document.getElementById('gpPlayers').innerHTML = `<div class="gp-h">Projected lines · this game <span>each player's 2026-27 projection, priced for this pace and this defense</span></div>
      <div class="gp-two"><div><div style="font-size:12px;font-weight:800;color:${col(team)};padding:8px 2px;">${sn(team)}</div>${playersTable(team, TA, col(team))}${injLine(pa, team)}</div>
      <div><div style="font-size:12px;font-weight:800;color:${col(oppName)};padding:8px 2px;">${sn(oppName)}</div>${row.oppName ? playersTable(oppName, TB, col(oppName)) : `<div class="gp-wrap"><div class="gp-empty">Opponent to be determined.</div></div>`}${injLine(pb, oppName)}</div></div>
      <div class="gp-note"><b>How the lines move:</b> ${[note(TA, team), note(TB, oppName)].filter(Boolean).join(' · ')}. Attempts scale with pace and minutes; makes use the matchup-adjusted percentages; offensive boards, defensive boards and turnovers are priced against this opponent's rebounding and turnover-forcing rates. Minutes come from the season projection; "vs avg" is the points swing against the player's season number. Rosters without a projected line yet (walk-ons, unfilled freshmen) are left out.</div>`;
    if (g.TDCGate) { const relock = () => { const el = document.getElementById('gpPlayers'); el.classList.remove('tdc-gate-wrap'); g.TDCGate.lock(el, { tier: 'pro', label: 'projected player lines', blurb: 'Pro, Coach\'s Tier and Betting Lab members see how every rotation player projects in this specific matchup — minutes, points, rebounds, assists and shooting.' }); };
      if (g.TDCGate.resolved && g.TDCGate.resolved()) relock(); else if (g.TDCGate.ready) g.TDCGate.ready.then(relock); }
  }

  g.TDCPreview = { render };
})(window);
