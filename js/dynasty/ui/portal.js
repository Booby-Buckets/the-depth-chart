// Offseason step 2: the transfer portal, played day by day (engine/portal.js). Fast: the best players commit in the
// first few days. Contact players (relationship), make NIL offers (they answer), watch the commitments roll in.
import { PORTAL_DAYS, CONTACTS_PER_DAY, openPortal, leaning, contact, offer, takeCounter, withdraw, portalDay } from '../engine/portal.js?v=50';
import { priorities, profile } from '../engine/recruit.js?v=50';
import { resolvePortal, tagsOf } from '../engine/offseason.js?v=50';
import { admitP, admitLabel, acadGrade, durability, durTag } from '../engine/people.js?v=50';

const PIL = ['SCO', 'SHT', 'FIN', 'PLY', 'SEC', 'REB', 'DEF'];
let pos = '', onlyOpen = true, q = '', msg = {};

export function portalView(ctx) {
  const S = ctx.get(), { esc, $, short, tm, ovrOf } = ctx, O = S.off, U = S.user;
  if (O.pday == null) { openPortal(S); ctx.autosave(); }   // saves made before the live portal
  const open = Math.max(0, 13 - S.teams[U].players.length), P = S.teams[U].prog;
  const day = O.pday || 0, done = day >= PORTAL_DAYS;
  const calls = PORTAL_DAYS - day > 0 ? CONTACTS_PER_DAY - ((O.contacts && O.contacts[day]) || []).length : 0;
  const m$ = k => '$' + (k >= 1000 ? (k / 1000).toFixed(2) + 'M' : Math.round(k) + 'k');
  const all = O.portal.map(id => S.players[id]).filter(Boolean);
  const list = all.filter(p => (!onlyOpen || !p.team || p.team === U) && (!pos || p.pos === pos) && (!q || p.name.toLowerCase().includes(q))).slice(0, 200);
  const promised = Object.entries(O.offers || {}).filter(([id, o]) => o && o.nil && S.players[id] && !S.players[id].team).reduce((s, [, o]) => s + o.nil, 0);
  const feed = (O.pfeed || []).filter(e => e.d === day).slice(0, 40);
  const mine = (O.pfeed || []).filter(e => e.to === U);
  const last = p => (p.hist && p.hist.length ? p.hist[p.hist.length - 1] : null);
  const row = p => {
    profile(S, p);
    const L = p.team ? null : leaning(S, p), of = O.offers[p.id], h = last(p);
    const st = p.team ? (p.team === U ? '<b class="pt-mine">✓ Signed with you</b>' : `→ ${esc(short(p.team))}`) : '';
    return `<tr class="${p.team === U ? 'pt-won' : p.team ? 'pt-gone' : ''}"><td class="l"><b>${esc(p.name)}</b><div class="dy-tags">${tagsOf(p.pillars, p.ht, p.sta).map(t => `<span>${esc(t)}</span>`).join('')}</div></td>
      <td class="l">${tm(p.from)}</td><td>${esc(p.pos || '')}</td><td>${p.ht ? `${Math.floor(p.ht / 12)}-${p.ht % 12}` : ''}</td><td><b>${ovrOf(p)}</b></td>
      ${PIL.map(k => `<td>${p.pillars[k]}</td>`).join('')}<td>${p.sta ?? ''}</td>
      <td class="dim">${h ? `${h.ppg}/${h.rpg}/${h.apg}` : '—'}</td><td>${esc(p.home === 'INTL' ? (p.country || 'Intl') : p.home || '')}</td><td class="${admitP(S, U, p, true) < 0.5 ? 'dn' : ''}" title="Academics ${acadGrade(p.acad ?? 60)} — elite academic schools take fewer transfers">${admitLabel(admitP(S, U, p, true))}</td><td title="${esc(durTag(p))}">${durability(p)}</td>
      <td class="l rv-w">${priorities(p).map(x => `<span>${esc(x)}</span>`).join('')}</td><td>${m$(p.ask)}</td>
      <td class="l rv-nilc">${p.team ? (of && of.nil ? m$(of.nil) : '') : `<input type="number" class="dy-min rv-nil" min="0" step="5" data-pnil="${esc(p.id)}" value="${of ? of.nil || 0 : ''}" placeholder="$k">
        ${p.nilState === 'counter' ? `<button class="btn ghost pg-sm" data-ptake="${esc(p.id)}">Take ${m$(p.counter)}</button>` : ''}${of ? ` <a href="#" data-pwd="${esc(p.id)}" title="Withdraw the offer">✕</a>` : ''}
        <div class="rv-st ${p.nilState || ''}">${msg[p.id] ? esc(msg[p.id]) : of ? (of.nil ? 'offer out' : 'scholarship offered') : ''}</div>`}</td>
      <td>${p.team || done ? '' : `<button class="btn ghost pg-sm" data-call="${esc(p.id)}" ${calls <= 0 ? 'disabled' : ''}>Call</button>`}</td>
      <td class="l pt-su">${L ? L.suitors.slice(0, 3).map(([t, pr]) => `<span class="${t === U ? 'pt-mine' : ''}">${t === U ? 'You' : esc(short(t))} ${Math.round(100 * pr)}%</span>`).join('') : st}</td>
      <td>${L && of ? `<b>${Math.round(100 * L.odds)}%</b>` : L ? '<span class="dim">offer first</span>' : ''}</td></tr>`;
  };
  $('#dyBody').innerHTML = (ctx.head || '') + `<div class="sec"><h2>Transfer portal — day ${Math.min(day, PORTAL_DAYS)} of ${PORTAL_DAYS}</h2><span class="n">It moves fast: the best players commit in the first few days. Transfers are proven (real ratings and stats), cost more NIL than high-schoolers, and start with almost no relationship — call them (each call +12) and meet his price. Each player hears from about five serious suitors; an offer puts you in the running.</span></div>
    <div class="pg-kv"><div><span>Open scholarships</span><b>${open}</b></div><div><span>Calls left today</span><b>${calls}</b></div>
      <div><span>NIL fund</span><b>${m$(P ? P.nil.fund : 0)}</b></div><div><span>Promised</span><b>${m$(promised)}</b></div><div><span>Signed</span><b>${mine.length}</b></div>
      <div><span>Still available</span><b>${all.filter(p => !p.team).length}</b></div></div>
    ${feed.length ? `<div class="pt-feed"><b>Day ${day} commitments:</b> ${feed.map(e => e.denied ? `<span class="dn">${esc(e.name)} picked you — denied admission</span>` : e.to ? `<span class="${e.to === U ? 'pt-mine' : ''}">${esc(e.name)} (${e.ovr}) → ${esc(short(e.to))}</span>` : `<span class="dim">${esc(e.name)} left D-I</span>`).join(' · ')}</div>` : ''}
    <div class="dy-btns">${done ? '<button class="btn" id="ptNext">Continue to recruiting →</button>' : `<button class="btn" id="ptDay">Next day →</button><button class="btn ghost" id="ptClose">Sim to the close</button><button class="btn ghost" id="ptAuto">Let my staff handle it</button>`}</div>
    <div class="dy-row"><input id="ptQ" class="dy-input" placeholder="Search players…" value="${esc(q)}"><select id="ptPos" class="dy-input"><option value="">All positions</option>${['PG', 'SG', 'SF', 'PF', 'C'].map(x => `<option ${x === pos ? 'selected' : ''}>${x}</option>`).join('')}</select>
      <label class="cal-chk"><input type="checkbox" id="ptOpen" ${onlyOpen ? 'checked' : ''}> Uncommitted only</label></div>
    <div class="sheet-wrap"><table class="sheet dense heat dy-portal"><thead><tr><th class="l">Player</th><th class="l">From</th><th>Pos</th><th>Ht</th><th data-heat="1">OVR</th>${PIL.map(k => `<th data-heat="1">${k}</th>`).join('')}<th data-heat="1">STA</th>
      <th title="Last season: points / rebounds / assists per game">Last yr</th><th>Home</th><th title="Can your school admit him as a transfer?">Admit</th><th title="Durability">DUR</th><th class="l">Wants</th><th>Ask</th><th class="l">Your offer</th><th></th><th class="l" title="The programs most in on him, and the chance he picks each if he decided today">Suitors</th><th title="Your chance if he decided today">Odds</th></tr></thead>
    <tbody>${list.map(row).join('')}</tbody></table></div>`;
  if (window.tdcSheetHeat) document.querySelectorAll('#dyBody table.heat').forEach(x => window.tdcSheetHeat(x));
  bind(ctx);
}

function bind(ctx) {
  const S = ctx.get(), $ = ctx.$, O = S.off;
  const again = () => { ctx.autosave(); portalView(ctx); };
  const on = (id, f) => { const e = $('#' + id); if (e) e.onclick = f; };
  on('ptDay', () => { portalDay(S); msg = {}; again(); });
  on('ptClose', () => { ctx.run(() => resolvePortal(S)); });
  on('ptNext', () => { ctx.run(() => resolvePortal(S)); });
  on('ptAuto', () => {
    const U = S.user, os = S.teams[U].players.map(id => ctx.ovrOf(S.players[id])).sort((a, b) => b - a), bar = os[7] ?? 60;
    O.portal.map(id => S.players[id]).filter(p => p && !p.team && ctx.ovrOf(p) > bar).slice(0, Math.max(0, 13 - S.teams[U].players.length) + 2)
      .forEach(p => { O.offers[p.id] = { nil: Math.round(p.ask * 0.9 / 5) * 5 }; });
    ctx.run(() => resolvePortal(S));
  });
  $('#ptQ').oninput = e => { q = e.target.value.toLowerCase().trim(); clearTimeout(bind.t); bind.t = setTimeout(() => { portalView(ctx); const i = $('#ptQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
  $('#ptPos').onchange = e => { pos = e.target.value; portalView(ctx); };
  $('#ptOpen').onchange = e => { onlyOpen = e.target.checked; portalView(ctx); };
  document.querySelectorAll('[data-call]').forEach(b => b.onclick = () => { const e = contact(S, b.dataset.call); msg[b.dataset.call] = e || 'Good call — he’s listening (relationship +12).'; again(); });
  document.querySelectorAll('[data-pnil]').forEach(i => i.onchange = () => {
    const P = S.teams[S.user].prog, others = Object.entries(O.offers || {}).filter(([id, o]) => id !== i.dataset.pnil && o && o.nil && S.players[id] && !S.players[id].team).reduce((s, [, o]) => s + o.nil, 0);
    if (P && others + (+i.value || 0) > P.nil.fund) { alert(`Your collective has $${P.nil.fund}k; $${others}k is already promised.`); return portalView(ctx); }
    const r = offer(S, i.dataset.pnil, i.value); msg[i.dataset.pnil] = r.msg; again();
  });
  document.querySelectorAll('[data-ptake]').forEach(b => b.onclick = () => { takeCounter(S, b.dataset.ptake); msg[b.dataset.ptake] = 'Deal.'; again(); });
  document.querySelectorAll('[data-pwd]').forEach(a => a.onclick = e => { e.preventDefault(); withdraw(S, a.dataset.pwd); msg[a.dataset.pwd] = 'Offer withdrawn.'; again(); });
}
