// In-season Recruiting tab: next year's class (scouted through your staff), official visits at your home games and
// home visits. Rules in engine/visits.js; signing day itself stays in the offseason (app.js).
import { scoutView, landOdds, scoutSD } from '../engine/offseason.js?v=29';
import { OFFICIAL_MAX, visitsLeft, visitsFor, upcomingHomeGames, scheduleOfficial, cancelVisit, homeVisit } from '../engine/visits.js?v=29';

let q = '', pos = '', minStars = 0, open = null;

export function recruitingView(ctx) {
  const S = ctx.get(), { esc, $, short } = ctx;
  const R = S.rclass || [];
  if (!R.length) { $('#dyBody').innerHTML = '<div class="dy-empty">The recruiting class appears at the start of the season.</div>'; return; }
  const P = S.teams[S.user].prog, home = upcomingHomeGames(S);
  const fmt = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const stars = n => '★'.repeat(n) + '<span class="dim">' + '★'.repeat(5 - n) + '</span>';
  const list = R.filter(r => (!q || r.name.toLowerCase().includes(q)) && (!pos || r.pos === pos) && r.stars >= minStars).slice(0, 150);
  const sched = (S.visits || []).filter(v => v.type === 'official' && !v.done);
  const done = (S.visits || []).filter(v => v.done);
  const PILLARS = ['SCO', 'SHT', 'FIN', 'PLY', 'SEC', 'REB', 'DEF'];
  const row = r => {
    const v = scoutView(S, r, r.vs || 0), V = visitsFor(S, r.id), off = V.find(x => x.type === 'official'), hv = V.find(x => x.type === 'home');
    const odds = Math.round(100 * landOdds(S, r, 20));
    const badge = x => `<span class="rv ${x.done ? x.res : 'sched'}" title="${x.type === 'home' ? 'Home visit' : 'Official visit'}${x.done ? ` — ${x.res} (${x.gain >= 0 ? '+' : ''}${x.gain})` : ` — ${fmt(x.d)}`}">${x.type === 'home' ? '🏠' : '🎓'}${x.done ? '' : ' ' + fmt(x.d)}</span>`;
    return `<tr><td>${r.rank}</td><td class="l"><b>${esc(r.name)}</b> ${V.map(badge).join(' ')}<div class="dy-tags">${v.tags.map(t => `<span>${esc(t)}</span>`).join('')}</div></td>
      <td class="l">${stars(r.stars)}</td><td>${esc(r.pos || '')}</td><td>${r.ht ? `${Math.floor(r.ht / 12)}-${r.ht % 12}` : ''}</td><td><b>${v.ovr}</b></td>
      ${PILLARS.map(k => `<td>${v.pillars[k]}</td>`).join('')}<td>${v.sta}</td><td><b>${v.grade}</b></td><td class="dim">±${v.sd}</td>
      <td title="Your odds at signing day with an average effort on him (visits included)"><b>${odds}%</b></td>
      <td class="l rv-act">${off ? (off.done ? '' : `<button class="btn ghost pg-sm" data-cancel="${esc(r.id)}|${esc(off.gid)}">Cancel</button>`)
        : `<button class="btn ghost pg-sm" data-off="${esc(r.id)}" ${visitsLeft(S) <= 0 || !home.length ? 'disabled' : ''}>Official visit</button>`}
        ${hv ? '' : `<button class="btn ghost pg-sm" data-home="${esc(r.id)}">Home visit</button>`}
        ${open === r.id ? `<div class="rv-pick">${home.slice(0, 10).map(g => `<button class="btn ghost pg-sm" data-pick="${esc(r.id)}|${esc(g.id)}">${fmt(g.d)} vs ${esc(short(g.a))}</button>`).join('')}</div>` : ''}</td></tr>`;
  };
  $('#dyBody').innerHTML = `<div class="sec"><h2>Recruiting — class of ${S.year + 1}</h2><span class="n">Scout and host next year's class during the season; you sign them in the offseason.</span></div>
    <div class="pg-kv"><div><span>Official visits</span><b>${visitsLeft(S)} / ${OFFICIAL_MAX} left</b></div><div><span>Free home visits</span><b>${P ? (P.hvFree ?? 2) : 0}</b></div><div><span>Recruiting momentum</span><b>${P ? P.acc.recruiting.toFixed(1) : '0'} wk</b></div>
      <div><span>Scouting accuracy</span><b>±${scoutSD(S, 0).toFixed(1)}</b></div><div><span>Home games left</span><b>${home.length}</b></div></div>
    <div class="pg-d">An <b>official visit</b> brings a recruit to one of your home games — a win, a big margin, a ranked opponent and your program's prestige all sell (a loss hurts), and your staff gets a long look at him. A <b>home visit</b> gives a smaller boost: two are free each season (the summer evaluation period), after that each costs a week of recruiting momentum. What a visit earns carries to signing day.</div>
    ${sched.length ? `<div class="rv-up"><b>Scheduled:</b> ${sched.map(v => { const r = R.find(x => x.id === v.rid), g = S.schedule.find(x => x.id === v.gid); return r && g ? `${fmt(g.d)} vs ${esc(short(g.a))} — ${esc(r.name)}` : ''; }).filter(Boolean).join(' · ')}</div>` : ''}
    ${done.length ? `<div class="rv-up dim">${done.slice(-6).reverse().map(v => { const r = R.find(x => x.id === v.rid); return r ? `${v.type === 'home' ? '🏠' : '🎓'} ${esc(r.name)}: ${v.res}` : ''; }).filter(Boolean).join(' · ')}</div>` : ''}
    <div class="dy-row"><input id="rvQ" class="dy-input" placeholder="Search recruits…" value="${esc(q)}">
      <select id="rvPos" class="dy-input"><option value="">All positions</option>${['PG', 'SG', 'SF', 'PF', 'C'].map(p => `<option ${p === pos ? 'selected' : ''}>${p}</option>`).join('')}</select>
      <select id="rvStars" class="dy-input"><option value="0">All stars</option>${[5, 4, 3, 2].map(n => `<option value="${n}" ${n === minStars ? 'selected' : ''}>${n}★ +</option>`).join('')}</select></div>
    <div class="sheet-wrap"><table class="sheet dense heat dy-rec"><thead><tr><th>#</th><th class="l">Recruit</th><th class="l">Stars</th><th>Pos</th><th>Ht</th><th data-heat="1">OVR</th>${PILLARS.map(k => `<th data-heat="1">${k}</th>`).join('')}<th data-heat="1">STA</th><th>POT</th><th title="Scouting accuracy (± rating points)">±</th><th>Odds</th><th class="l">Visits</th></tr></thead>
    <tbody>${list.map(row).join('')}</tbody></table></div>`;
  if (window.tdcSheetHeat) document.querySelectorAll('#dyBody table.heat').forEach(x => window.tdcSheetHeat(x));
  bind(ctx);
}

function bind(ctx) {
  const S = ctx.get(), $ = ctx.$;
  const again = () => { ctx.autosave(); recruitingView(ctx); };
  $('#rvQ').oninput = e => { q = e.target.value.toLowerCase().trim(); clearTimeout(bind.t); bind.t = setTimeout(() => { recruitingView(ctx); const i = $('#rvQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
  $('#rvPos').onchange = e => { pos = e.target.value; recruitingView(ctx); };
  $('#rvStars').onchange = e => { minStars = +e.target.value; recruitingView(ctx); };
  document.querySelectorAll('[data-off]').forEach(b => b.onclick = () => { open = open === b.dataset.off ? null : b.dataset.off; recruitingView(ctx); });
  document.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { const [rid, gid] = b.dataset.pick.split('|'); const e = scheduleOfficial(S, rid, gid); open = null; if (e) alert(e); again(); });
  document.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => { const [rid, gid] = b.dataset.cancel.split('|'); cancelVisit(S, rid, gid); again(); });
  document.querySelectorAll('[data-home]').forEach(b => b.onclick = () => { const e = homeVisit(S, b.dataset.home); if (e) alert(e); again(); });
}
