// Tournaments tab (NCAA / NIT / CBI / conference tournaments / early-season events / bracketology) and the Awards
// tab (national + every conference, coaches). Rules live in engine/postseason.js, engine/mte.js, engine/awards.js.
import { projectField, ctFormat } from '../engine/postseason.js?v=44';
import { mteFinish } from '../engine/mte.js?v=44';
import { confLabel } from '../engine/awards.js?v=44';

let view = null, ctSel = null, evSel = null, awConf = null;

function bracketKit(ctx) {
  const S = ctx.get(), { esc, tm } = ctx;
  const slotTxt = s => !s ? '' : s.team ? `<span class="sd">${s.seed}</span>${tm(s.team)}` : '';
  const gameTxt = (s, seedOf = x => x) => {
    if (!s) return '<div class="bg empty">—</div>';
    if (s.team) return `<div class="bg"><div class="w">${slotTxt(Object.assign({}, s, { seed: seedOf(s.seed) }))}</div></div>`;
    const g = S.schedule.find(x => x.id === s.game), r = g && g.r;
    const row = (t, pts, won) => `<div class="${r ? (won ? 'w' : 'l') : ''}"><span class="sd">${seedOf(t.seed)}</span>${tm(t.team, t.team === S.user ? 'me' : '')}<b>${r ? pts : ''}</b></div>`;
    return `<div class="bg">${row(s.h, r && r[0], r && r[0] > r[1])}${row(s.a, r && r[1], r && r[1] > r[0])}${g && !g.n ? `<div class="dim bh">at ${esc(ctx.short(g.h))}</div>` : ''}</div>`;
  };
  const roundName = (br, rd) => {
    const R = br.rounds[rd] || [], left = R.length;
    if (left === 1 && R[0] && R[0].team) return 'Champion';
    if (br.kind === 'ncaa') return { 32: 'Round of 64', 16: 'Round of 32', 8: 'Sweet 16', 4: 'Elite Eight', 2: 'Final Four', 1: 'Championship' }[left] || '';
    if (br.kind === 'nit' || br.kind === 'cbi') return { 16: 'First round', 8: left === br.size / 2 ? 'First round' : 'Second round', 4: 'Quarterfinals', 2: 'Semifinals', 1: 'Championship' }[left] || '';
    return left === 1 ? 'Final' : left === 2 ? 'Semifinals' : left === 4 ? 'Quarterfinals' : `Round ${rd}`;
  };
  const bracket = (br, seedOf) => `<div class="dy-br">${br.rounds.slice(1).map((rd, i) => `<div class="col"><div class="rh">${roundName(br, i + 1)}</div>${rd.map(s => gameTxt(s, seedOf)).join('')}</div>`).join('')}</div>`;
  return { gameTxt, bracket };
}

export function tournamentsView(ctx) {
  const S = ctx.get(), { esc, tm, short, $ } = ctx, P = S.post;
  const K = bracketKit(ctx);
  const tabs = [];
  if (P && P.ncaa) tabs.push(['ncaa', 'NCAA']);
  if (P && P.nit) tabs.push(['nit', 'NIT']);
  if (P && P.cbi) tabs.push(['cbi', 'CBI']);
  if (P) tabs.push(['conf', 'Conference tournaments']);
  tabs.push(['events', 'Early-season events']);
  if (S.phase === 'regular') tabs.push(['bracketology', 'Bracketology']);
  if (!view || !tabs.some(t => t[0] === view)) view = tabs[0][0];
  let html = `<div class="tn-tabs">${tabs.map(([k, l]) => `<button class="${k === view ? 'on' : ''}" data-tn="${k}">${l}</button>`).join('')}</div>`;

  if (view === 'ncaa') {
    const N = P.ncaa;
    html += `<div class="sec"><h2>NCAA tournament</h2><span class="n">${N.champ ? '🏆 ' + esc(short(N.champ)) : `${N.autoBids.length} automatic bids · ${68 - N.autoBids.length} at-large`}</span></div>
      <div class="dy-ff"><b>First Four</b> ${N.firstFour.map(f => K.gameTxt(f.slot)).join('')}</div>
      ${N.main ? K.bracket(N.main) : '<div class="dy-empty">The field of 64 is set once the First Four is played.</div>'}`;
  } else if (view === 'nit' || view === 'cbi') {
    const B = P[view], nit = view === 'nit';
    html += `<div class="sec"><h2>${nit ? 'National Invitation Tournament' : 'College Basketball Invitational'}</h2><span class="n">${B.champ ? '🏆 ' + esc(short(B.champ)) : nit ? '32 teams — regular-season champions who lost their tournament get in; the higher seed hosts through the quarterfinals, then a neutral-site final four' : '16 teams from outside the power leagues, all games on one neutral floor'}</span></div>
      ${K.bracket(B, nit ? s => Math.ceil(s / 4) : undefined)}`;
  } else if (view === 'conf') {
    const conf = P.conf, sel = ctSel && conf[ctSel] ? ctSel : S.teams[S.user].conf;
    const F = ctFormat(sel), C = conf[sel];
    html += `<div class="sec"><h2>Conference tournaments</h2><select id="ctSel" class="dy-input sm">${Object.keys(conf).sort().map(c => `<option value="${esc(c)}" ${c === sel ? 'selected' : ''}>${esc(confLabel(c))}${conf[c].champ ? ' — ' + esc(short(conf[c].champ)) : ''}</option>`).join('')}</select></div>
      ${C ? `<div class="pg-d">${F.n ? `Top ${F.n} qualify` : 'Every team qualifies'}${F.home ? ` · the first ${F.home === 1 ? 'round is' : F.home + ' rounds are'} on the higher seed's floor` : ' · neutral site'} · top seeds earn byes · the champion takes the automatic NCAA bid${C.reg && C.champ && C.reg !== C.champ ? ` · regular-season champ ${esc(short(C.reg))} lost — a guaranteed NIT bid` : ''}</div>${K.bracket(C)}` : ''}`;
  } else if (view === 'events') {
    html += eventsHtml(ctx);
  } else if (view === 'bracketology') {
    const B = projectField(S);
    html += `<div class="sec"><h2>Bracketology</h2><span class="n">If the season ended today: conference leaders take the automatic bids, the rest by power rating · FF = First Four play-in</span></div>
      <div class="sheet-wrap"><table class="sheet dense tn-bk"><thead><tr><th>Seed</th><th class="l" colspan="6">Teams</th></tr></thead><tbody>
      ${B.lines.map(ln => `<tr><td><b>${ln.seed}</b></td>${ln.teams.map(x => `<td class="l ${x.team === S.user ? 'me' : ''}">${tm(x.team)}${x.auto ? ' <span class="dim" title="Automatic bid (leads its conference)">AQ</span>' : ''}${x.ff ? ' <span class="dim" title="First Four play-in">FF</span>' : ''}</td>`).join('')}${'<td></td>'.repeat(6 - ln.teams.length)}</tr>`).join('')}
      </tbody></table></div>
      <div class="pg-kv"><div><span>Last four in</span><b class="tn-l">${B.lastIn.map(t => esc(short(t))).join(', ')}</b></div><div><span>First four out</span><b class="tn-l">${B.firstOut.map(t => esc(short(t))).join(', ')}</b></div>
      <div><span>${esc(short(S.user))}</span><b>${(() => { const ln = B.lines.find(l => l.teams.some(x => x.team === S.user)); return ln ? `${ln.seed} seed` : B.firstOut.includes(S.user) ? 'First four out' : 'Out'; })()}</b></div></div>`;
  }
  $('#dyBody').innerHTML = html;
  document.querySelectorAll('[data-tn]').forEach(b => b.onclick = () => { view = b.dataset.tn; tournamentsView(ctx); });
  const cs = $('#ctSel'); if (cs) cs.onchange = e => { ctSel = e.target.value; tournamentsView(ctx); };
  const es = $('#evSel'); if (es) es.onchange = e => { evSel = e.target.value; tournamentsView(ctx); };
}

// the season's multi-team events: generated seasons carry full brackets (state.mtes); the first season's real
// events are grouped from the schedule's event names
function eventsHtml(ctx) {
  const S = ctx.get(), { esc, tm, short } = ctx;
  const fmt = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const score = g => g && g.r ? `${g.r[0]}-${g.r[1]}` : fmt(g.d);
  const gm = g => !g ? '' : `<div class="tn-g ${g.r ? '' : 'dim'}">${tm(g.h, g.h === S.user ? 'me' : '')} ${g.r ? (g.r[0] > g.r[1] ? '<b>W</b>' : 'L') : 'vs'} ${tm(g.a, g.a === S.user ? 'me' : '')} <span class="dim">${score(g)}</span></div>`;
  if (S.mtes && S.mtes.length) {
    const mine = S.mtes.filter(m => m.teams.some(x => x.team === S.user));
    const sel = S.mtes.find(m => m.id === evSel) || mine[0] || S.mtes[0];
    const F = mteFinish(S, sel);
    const PL = ['Champion', 'Runner-up', '3rd', '4th', '5th', '6th', '7th', '8th'];
    return `<div class="sec"><h2>Early-season events</h2><select id="evSel" class="dy-input sm">${S.mtes.map(m => { const f = mteFinish(S, m); return `<option value="${esc(m.id)}" ${m === sel ? 'selected' : ''}>${esc(m.name)}${f.champ ? ' — ' + esc(short(f.champ)) : ''}${m.teams.some(x => x.team === S.user) ? ' ★' : ''}</option>`; }).join('')}</select></div>
      <div class="pg-d"><b>${esc(sel.name)}</b> · ${esc(sel.site)} · ${sel.showcase ? 'showcase double-header' : sel.size === 8 ? '8 teams, three days — everyone plays three games (winners and consolation brackets)' : '4 teams, two days'} · ${sel.days.map(fmt).join(' – ')}</div>
      <div class="tn-ev"><div><h4>Field</h4>${sel.teams.map(x => `<div>${x.seed}. ${tm(x.team, x.team === S.user ? 'me' : '')}</div>`).join('')}</div>
        <div><h4>Games</h4>${sel.days.map((d, i) => { const G = F.games.filter(g => g && g.d === d); return G.length ? `<div class="tn-day">${sel.days.length > 1 ? `Day ${i + 1} · ` : ''}${fmt(d)}${sel.size === 8 && i === 1 ? ' — semifinals + consolation' : sel.size === 8 && i === 2 ? ' — final, 3rd, 5th, 7th' : ''}</div>${G.map(gm).join('')}` : ''; }).join('') || '<div class="dim">Not played yet.</div>'}</div>
        ${F.places ? `<div><h4>Final standing</h4>${F.places.map((t, i) => `<div>${PL[i]} ${tm(t, t === S.user ? 'me' : '')}</div>`).join('')}</div>` : ''}</div>
      <div class="sec"><h2>All events</h2></div><div class="sheet-wrap"><table class="sheet dense"><thead><tr><th class="l">Event</th><th class="l">Site</th><th>Teams</th><th class="l">Champion</th></tr></thead><tbody>
      ${S.mtes.map(m => { const f = mteFinish(S, m); return `<tr class="${m.teams.some(x => x.team === S.user) ? 'me' : ''}"><td class="l">${esc(m.name)}</td><td class="l dim">${esc(m.site)}</td><td>${m.teams.length}</td><td class="l">${f.champ ? tm(f.champ) : m.showcase ? '—' : '<span class="dim">TBD</span>'}</td></tr>`; }).join('')}</tbody></table></div>`;
  }
  // first season: the real events, from the schedule
  const ev = {}; for (const g of S.schedule) if (g.ev) (ev[g.ev] = ev[g.ev] || []).push(g);
  const names = Object.keys(ev).sort();
  if (!names.length) return '<div class="dy-empty">No multi-team events on this season\'s schedule.</div>';
  const mineN = names.filter(n => ev[n].some(g => g.h === S.user || g.a === S.user));
  const sel = names.includes(evSel) ? evSel : mineN[0] || names[0];
  return `<div class="sec"><h2>Early-season events</h2><select id="evSel" class="dy-input sm">${names.map(n => `<option value="${esc(n)}" ${n === sel ? 'selected' : ''}>${esc(n)}${mineN.includes(n) ? ' ★' : ''}</option>`).join('')}</select></div>
    <div class="pg-d">This season's real events (from the 2026-27 schedules). From next season on, every event is generated with a full bracket.</div>
    <div class="tn-ev"><div><h4>Games</h4>${ev[sel].sort((a, b) => (a.d < b.d ? -1 : 1)).map(gm).join('')}</div></div>`;
}

// ── awards ──
export function awardsView(ctx) {
  const S = ctx.get(), { esc, tm, short, $ } = ctx;
  const A = S.awards || (S.history.at(-1) && S.history.at(-1).awards);
  if (!A) { $('#dyBody').innerHTML = '<div class="sec"><h2>Awards</h2></div><div class="dy-empty">Awards are announced when the season ends.</div>'; return; }
  const who = x => S.players[x.id] ? ctx.pl(S.players[x.id], false) : esc(x.name);
  const row = (lbl, x, extra = '') => x ? `<tr class="${x.team === S.user ? 'me' : ''}"><td class="l"><b>${lbl}</b></td><td class="l">${who(x)}</td><td class="l">${tm(x.team)}</td><td>${x.ppg ?? ''}</td><td>${x.rpg ?? ''}</td><td>${x.apg ?? ''}</td><td class="l dim">${extra}</td></tr>` : '';
  const team = (lbl, list) => (list || []).filter(Boolean).map((x, i) => row(i ? '' : lbl, x)).join('');
  const coach = (lbl, c) => c ? `<tr class="${c.team === S.user ? 'me' : ''}"><td class="l"><b>${lbl}</b></td><td class="l">${esc(c.coach || '')}</td><td class="l">${tm(c.team)}</td><td colspan="3">${c.w}-${c.l}${c.cw + c.cl ? ` (${c.cw}-${c.cl})` : ''}</td><td></td></tr>` : '';
  const head = '<thead><tr><th class="l">Award</th><th class="l">Name</th><th class="l">Team</th><th>PPG</th><th>RPG</th><th>APG</th><th></th></tr></thead>';
  const confs = Object.keys(A.conf || {}).sort((a, b) => confLabel(a).localeCompare(confLabel(b)));
  const sel = awConf && confs.includes(awConf) ? awConf : (confs.includes(S.teams[S.user].conf) ? S.teams[S.user].conf : confs[0]);
  const F = A.cf && A.cf[sel];
  $('#dyBody').innerHTML = `<div class="sec"><h2>${A.year - 1}-${String(A.year).slice(2)} national awards</h2></div>
    <div class="sheet-wrap"><table class="sheet dense dy-aw">${head}<tbody>
      ${row('Player of the Year', A.poy)}${row('Defensive Player of the Year', A.dpoy)}${row('Freshman of the Year', A.fr)}${row('Sixth Man of the Year', A.smoy)}
      ${row('Most Improved Player', A.mip, A.mip ? `+${A.mip.gain} OVR` : '')}${coach('Coach of the Year', A.coy)}
      ${team('All-America 1st team', A.aa1)}${team('All-America 2nd team', A.aa2)}${team('All-America 3rd team', A.aa3)}
    </tbody></table></div>
    <div class="sec"><h2>Conference awards</h2><select id="awConf" class="dy-input sm">${confs.map(c => `<option value="${esc(c)}" ${c === sel ? 'selected' : ''}>${esc(confLabel(c))}</option>`).join('')}</select></div>
    ${F ? `<div class="sheet-wrap"><table class="sheet dense dy-aw">${head}<tbody>
      ${row('Player of the Year', F.poy)}${row('Defensive Player of the Year', F.dpoy)}${row('Freshman of the Year', F.fr)}${row('Sixth Man of the Year', F.smoy)}${coach('Coach of the Year', F.coy)}
      ${team(`All-${confLabel(sel)} 1st team`, F.t1)}${team(`All-${confLabel(sel)} 2nd team`, F.t2)}${team(`All-${confLabel(sel)} 3rd team`, F.t3)}
      ${team('All-Freshman team', F.frT)}${team('All-Defensive team', F.defT)}</tbody></table></div>`
      : `<div class="pg-d">Full conference teams are kept for the latest season only.</div>`}
    <div class="sec"><h2>Every league's player and coach of the year</h2></div><div class="sheet-wrap"><table class="sheet dense dy-awc"><thead><tr><th class="l">Conference</th><th class="l">Player of the Year</th><th class="l">Team</th><th>PPG</th><th class="l">Coach of the Year</th><th class="l">Team</th></tr></thead><tbody>
      ${confs.map(c => { const x = A.conf[c], k = A.confCoy && A.confCoy[c]; return `<tr class="${(x && x.team === S.user) || (k && k.team === S.user) ? 'me' : ''}"><td class="l">${esc(confLabel(c))}</td><td class="l">${x ? who(x) : ''}</td><td class="l">${x ? tm(x.team) : ''}</td><td>${x ? x.ppg : ''}</td><td class="l">${k ? esc(k.coach || '') : ''}</td><td class="l">${k ? tm(k.team) : ''}</td></tr>`; }).join('')}
    </tbody></table></div>`;
  const s = $('#awConf'); if (s) s.onchange = e => { awConf = e.target.value; awardsView(ctx); };
  ctx.bindPlayers && ctx.bindPlayers();
}
