// In-season Recruiting tab: next year's class (scouted through your staff), official visits at your home games and
// home visits. Rules in engine/visits.js; signing day itself stays in the offseason (app.js).
import { scoutView, landOdds, scoutSD } from '../engine/offseason.js?v=44';
import { pursuit, priorities, negotiate, acceptCounter, FACTORS, committedNIL, profile, relationship } from '../engine/recruit.js?v=44';
import { OFFICIAL_MAX, TARGET_MAX, toggleTarget, visitsLeft, visitsFor, upcomingHomeGames, scheduleOfficial, cancelVisit, homeVisit } from '../engine/visits.js?v=44';

let q = '', pos = '', minStars = 0, onlyT = false, open = null, detail = null, lastMsg = {};

export function recruitingView(ctx) {
  const S = ctx.get(), { esc, $, short } = ctx;
  const R = S.rclass || [];
  if (!R.length) { $('#dyBody').innerHTML = '<div class="dy-empty">The recruiting class appears at the start of the season.</div>'; return; }
  const P = S.teams[S.user].prog, home = upcomingHomeGames(S);
  const fmt = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const stars = n => '★'.repeat(n) + '<span class="dim">' + '★'.repeat(5 - n) + '</span>';
  const TG = S.targets || [];
  const list = R.filter(r => (!onlyT || TG.includes(r.id)) && (!q || r.name.toLowerCase().includes(q)) && (!pos || r.pos === pos) && r.stars >= minStars).slice(0, 150);
  const sched = (S.visits || []).filter(v => v.type === 'official' && !v.done);
  const done = (S.visits || []).filter(v => v.done);
  const PILLARS = ['SCO', 'SHT', 'FIN', 'PLY', 'SEC', 'REB', 'DEF'];
  const m$ = k => '$' + (k >= 1000 ? (k / 1000).toFixed(2) + 'M' : Math.round(k) + 'k');
  const row = r => {
    profile(S, r);
    const v = scoutView(S, r, r.vs || 0), V = visitsFor(S, r.id), off = V.find(x => x.type === 'official'), hv = V.find(x => x.type === 'home');
    const odds = Math.round(100 * landOdds(S, r, 20)), P2 = pursuit(S, r, 20);
    const nilCell = `<input type="number" class="dy-min rv-nil" min="0" step="5" data-nil="${esc(r.id)}" value="${r.offer || ''}" placeholder="$k">${r.nilState === 'counter' ? ` <button class="btn ghost pg-sm" data-takec="${esc(r.id)}">Take ${m$(r.counter)}</button>` : ''}
      <div class="rv-st ${r.nilState || ''}">${r.nilState === 'accepted' ? '✓ deal' : r.nilState === 'counter' ? 'counter' : r.nilState === 'low' ? 'lukewarm' : r.nilState === 'insulted' ? 'insulted' : ''}</div>`;
    const badge = x => `<span class="rv ${x.done ? x.res : 'sched'}" title="${x.type === 'home' ? 'Home visit' : 'Official visit'}${x.done ? ` — ${x.res} (${x.gain >= 0 ? '+' : ''}${x.gain})` : ` — ${fmt(x.d)}`}">${x.type === 'home' ? '🏠' : '🎓'}${x.done ? '' : ' ' + fmt(x.d)}</span>`;
    const tg = TG.includes(r.id), rel = Math.round(relationship(S, r, 0));
    return `<tr class="${tg ? 'rv-tg' : ''}"><td><button class="rv-star ${tg ? 'on' : ''}" data-tgt="${esc(r.id)}" title="${tg ? 'Stop working him' : 'Make him a target: your staff builds the relationship every week'}">${tg ? '★' : '☆'}</button></td><td>${r.rank}</td><td class="l"><b>${esc(r.name)}</b> ${V.map(badge).join(' ')}<div class="dy-tags">${v.tags.map(t => `<span>${esc(t)}</span>`).join('')}</div></td>
      <td class="l">${stars(r.stars)}</td><td>${esc(r.pos || '')}</td><td>${r.ht ? `${Math.floor(r.ht / 12)}-${r.ht % 12}` : ''}</td><td><b>${v.ovr}</b></td>
      ${PILLARS.map(k => `<td>${v.pillars[k]}</td>`).join('')}<td>${v.sta}</td><td><b>${v.grade}</b></td><td class="dim">±${v.sd}</td>
      <td title="Relationship (0-100). Targets warm up every week with your recruiting hours.">${rel}</td><td>${esc(r.home === 'INTL' ? 'Intl' : r.home || '')}</td><td class="l rv-w">${priorities(r).map(x => `<span>${esc(x)}</span>`).join('')}</td>
      <td>${m$(r.ask)}</td><td class="l rv-nilc">${nilCell}</td>
      <td class="l">${P2.rival ? `<a href="#" data-detail="${esc(r.id)}" title="See how he compares you">${esc(short(P2.rival))}</a>` : '—'}</td>
      <td title="Your odds at signing day with an average effort on him (visits + NIL included)"><b>${odds}%</b></td>
      <td class="l rv-act">${off ? (off.done ? '' : `<button class="btn ghost pg-sm" data-cancel="${esc(r.id)}|${esc(off.gid)}">Cancel</button>`)
        : `<button class="btn ghost pg-sm" data-off="${esc(r.id)}" ${visitsLeft(S) <= 0 || !home.length ? 'disabled' : ''}>Official visit</button>`}
        ${hv ? '' : `<button class="btn ghost pg-sm" data-home="${esc(r.id)}">Home visit</button>`}
        ${open === r.id ? `<div class="rv-pick">${home.slice(0, 10).map(g => `<button class="btn ghost pg-sm" data-pick="${esc(r.id)}|${esc(g.id)}">${fmt(g.d)} vs ${esc(short(g.a))}</button>`).join('')}</div>` : ''}</td></tr>`
      + (detail === r.id ? `<tr class="rv-det"><td colspan="24"><div class="rv-bk"><b>How ${esc(r.name)} sees it</b> — you vs ${esc(short(P2.rival || ''))}${lastMsg[r.id] ? ` · <i>${esc(lastMsg[r.id])}</i>` : ''}
        ${FACTORS.map(([k, l]) => `<div class="rv-f"><span class="lb">${l}<em>${Math.round(r.w[k] * 100)}%</em></span><span class="pg-bar"><i style="width:${Math.round(100 * P2.f[k])}%;background:var(--green,#1a8c3a)"></i></span><span class="pg-bar"><i style="width:${Math.round(100 * (P2.rf ? P2.rf[k] : 0))}%;background:#8a8f99"></i></span></div>`).join('')}
        <div class="pg-d">Green = your program, grey = ${esc(short(P2.rival || 'the rival'))}. The % is how much he cares. Relationship ${Math.round(P2.rel)}/100 — effort points on signing day, visits and your recruiting coordinator build it.</div></div></td></tr>` : '');
  };
  $('#dyBody').innerHTML = `<div class="sec"><h2>Recruiting — class of ${S.phase === "offseason" ? S.year : S.year + 1}</h2><span class="n">Scout and host next year's class during the season; you sign them in the offseason.</span></div>
    <div class="pg-kv"><div><span>Official visits</span><b>${visitsLeft(S)} / ${OFFICIAL_MAX} left</b></div><div><span>Free home visits</span><b>${P ? (P.hvFree ?? 2) : 0}</b></div><div><span>Recruiting momentum</span><b>${P ? P.acc.recruiting.toFixed(1) : '0'} wk</b></div>
      <div><span>Targets</span><b>${TG.length} / ${TARGET_MAX}</b></div><div><span>Scouting accuracy</span><b>±${scoutSD(S, 0).toFixed(1)}</b></div><div><span>Home games left</span><b>${home.length}</b></div><div><span>NIL offers out</span><b>${m$(committedNIL(S))} of ${m$(P ? P.nil.fund : 0)}</b></div></div>
    <div class="pg-d">High-school recruiting is the long game. <b>★ Target</b> a recruit and your staff works him every week — the relationship grows with your recruiting hours, so start early. High-schoolers cost less NIL than transfers and your staff knows them better, but they're a gamble: some bust, some blossom (the ± is how sure your staff is). An <b>official visit</b> brings a recruit to one of your home games — a win, a big margin, a ranked opponent and your program's prestige all sell (a loss hurts), and your staff gets a long look at him. A <b>home visit</b> gives a smaller boost: two are free each season (the summer evaluation period), after that each costs a week of recruiting momentum. What a visit earns carries to signing day.</div>
    ${sched.length ? `<div class="rv-up"><b>Scheduled:</b> ${sched.map(v => { const r = R.find(x => x.id === v.rid), g = S.schedule.find(x => x.id === v.gid); return r && g ? `${fmt(g.d)} vs ${esc(short(g.a))} — ${esc(r.name)}` : ''; }).filter(Boolean).join(' · ')}</div>` : ''}
    ${done.length ? `<div class="rv-up dim">${done.slice(-6).reverse().map(v => { const r = R.find(x => x.id === v.rid); return r ? `${v.type === 'home' ? '🏠' : '🎓'} ${esc(r.name)}: ${v.res}` : ''; }).filter(Boolean).join(' · ')}</div>` : ''}
    <div class="dy-row"><input id="rvQ" class="dy-input" placeholder="Search recruits…" value="${esc(q)}">
      <select id="rvPos" class="dy-input"><option value="">All positions</option>${['PG', 'SG', 'SF', 'PF', 'C'].map(p => `<option ${p === pos ? 'selected' : ''}>${p}</option>`).join('')}</select>
      <label class="cal-chk"><input type="checkbox" id="rvT" ${onlyT ? 'checked' : ''}> Targets only</label>
      <select id="rvStars" class="dy-input"><option value="0">All stars</option>${[5, 4, 3, 2].map(n => `<option value="${n}" ${n === minStars ? 'selected' : ''}>${n}★ +</option>`).join('')}</select></div>
    <div class="sheet-wrap"><table class="sheet dense heat dy-rec"><thead><tr><th title="Target">★</th><th>#</th><th class="l">Recruit</th><th class="l">Stars</th><th>Pos</th><th>Ht</th><th data-heat="1">OVR</th>${PILLARS.map(k => `<th data-heat="1">${k}</th>`).join('')}<th data-heat="1">STA</th><th>POT</th><th title="Scouting accuracy (± rating points)">±</th><th title="Relationship (0-100)">Rel</th><th>From</th><th class="l">Wants</th><th title="His NIL asking price ($ a year)">Ask</th><th class="l" title="Your NIL offer ($k a year). He answers: accepts, counters, or feels lowballed.">Your offer</th><th class="l">Top rival</th><th>Odds</th><th class="l">Visits</th></tr></thead>
    <tbody>${list.map(row).join('')}</tbody></table></div>`;
  if (window.tdcSheetHeat) document.querySelectorAll('#dyBody table.heat').forEach(x => window.tdcSheetHeat(x));
  bind(ctx);
}

function bind(ctx) {
  const S = ctx.get(), $ = ctx.$;
  const again = () => { ctx.autosave(); recruitingView(ctx); };
  $('#rvQ').oninput = e => { q = e.target.value.toLowerCase().trim(); clearTimeout(bind.t); bind.t = setTimeout(() => { recruitingView(ctx); const i = $('#rvQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
  $('#rvPos').onchange = e => { pos = e.target.value; recruitingView(ctx); };
  $('#rvT').onchange = e => { onlyT = e.target.checked; recruitingView(ctx); };
  document.querySelectorAll('[data-tgt]').forEach(b => b.onclick = () => { const e = toggleTarget(S, b.dataset.tgt); if (e) alert(e); again(); });
  $('#rvStars').onchange = e => { minStars = +e.target.value; recruitingView(ctx); };
  document.querySelectorAll('[data-off]').forEach(b => b.onclick = () => { open = open === b.dataset.off ? null : b.dataset.off; recruitingView(ctx); });
  document.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { const [rid, gid] = b.dataset.pick.split('|'); const e = scheduleOfficial(S, rid, gid); open = null; if (e) alert(e); again(); });
  document.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => { const [rid, gid] = b.dataset.cancel.split('|'); cancelVisit(S, rid, gid); again(); });
  document.querySelectorAll('[data-home]').forEach(b => b.onclick = () => { const e = homeVisit(S, b.dataset.home); if (e) alert(e); again(); });
  document.querySelectorAll('[data-detail]').forEach(a => a.onclick = e => { e.preventDefault(); detail = detail === a.dataset.detail ? null : a.dataset.detail; recruitingView(ctx); });
  document.querySelectorAll('[data-nil]').forEach(i => i.onchange = () => {
    const r = (S.rclass || []).find(x => x.id === i.dataset.nil); if (!r) return;
    const P = S.teams[S.user].prog, others = committedNIL(S) - (r.nilState === 'accepted' ? r.offer : 0);
    if (P && others + (+i.value || 0) > P.nil.fund) { alert(`Your collective has $${P.nil.fund}k; $${others}k is already promised.`); return recruitingView(ctx); }
    const res = negotiate(S, r, i.value); lastMsg[r.id] = res.msg; detail = r.id; again();
  });
  document.querySelectorAll('[data-takec]').forEach(b => b.onclick = () => { const r = (S.rclass || []).find(x => x.id === b.dataset.takec); if (r) { acceptCounter(S, r); lastMsg[r.id] = `${r.name} accepts $${r.offer}k a year.`; } again(); });
}
