// Offseason step 5: build next season's non-conference schedule (engine/schedule.js). League games, rivalries and
// home-and-home returns are set; the user picks an event (or none) and fills the open dates — buy games (you pay),
// guarantee games (they pay you), home-and-homes, neutral sites — and the AD fills whatever is left by the same
// rules the AI programs use.
import { userSchedInfo, eventOptions, askGame, addGame, removeGame, chooseEvent, tiers, TIER_NAME } from '../engine/schedule.js?v=73';
import { power } from '../engine/season.js?v=73';
import { miles } from '../engine/recruit.js?v=73';
import { confLabel } from '../engine/awards.js?v=73';

let q = '', tierF = '', msg = '';

export function scheduleStep(ctx) {
  const S = ctx.get(), { esc, $, short, tm } = ctx, U = S.user, I = userSchedInfo(S), T = tiers(S);
  const pw = power(S), order = Object.keys(pw).sort((a, b) => pw[b] - pw[a]), rank = Object.fromEntries(order.map((t, i) => [t, i + 1]));
  const m$ = k => '$' + (k >= 1000 ? (k / 1000).toFixed(2) + 'M' : Math.round(k) + 'k');
  const V = { H: 'Home', A: 'Away', N: 'Neutral' };
  const KIND = { buy: 'Buy game', gtee: 'Guarantee game', hah: 'Home-and-home', road: 'Road game', neutral: 'Neutral site' };
  const evs = eventOptions(S), ev = I.sched.event;
  const money = I.sched.games.reduce((s, g) => s + (g.kind === 'buy' ? -g.pay : g.kind === 'gtee' ? g.pay : 0), 0);
  // non-conference strength: last season's power rank of everyone you've set (locked + picks)
  const opps = I.locked.map(l => l.opp).concat(I.sched.games.map(g => g.opp));
  const avgRank = opps.length ? Math.round(opps.reduce((s, o) => s + (rank[o] || 180), 0) / opps.length) : null;
  const avgTxt = avgRank == null ? '—' : `#${avgRank}`;
  const pool = Object.values(S.teams).filter(t => t.name !== U && t.conf !== I.conf && !opps.includes(t.name)
      && (!q || t.name.toLowerCase().includes(q)) && (tierF === '' || T[t.name] === +tierF))
    .sort((a, b) => (rank[a.name] || 999) - (rank[b.name] || 999)).slice(0, 120);
  const st = S.teams[U].state;
  const row = t => {
    const o = t.name, ask = v => askGame(S, o, v);
    const btn = v => { const r = ask(v); return `<button class="btn ghost pg-sm ${r.ok ? '' : 'no'}" data-add="${esc(o)}|${v}" title="${esc(r.msg)}" ${I.open <= 0 ? 'disabled' : ''}>${V[v]}${r.ok && r.pay ? ` <span class="${r.pay > 0 ? 'up' : 'dn'}">${r.pay > 0 ? '+' : '−'}$${Math.abs(r.pay)}k</span>` : r.ok ? '' : ' ✕'}</button>`; };
    return `<tr><td class="l">${tm(o)}</td><td class="l dim">${esc(confLabel(t.conf))}</td><td>${TIER_NAME[T[o]]}</td><td>#${rank[o] || '—'}</td><td>${t.prestige}</td><td>${Math.round(miles(st, t.state))}</td><td class="l sc-b">${btn('H')}${btn('A')}${btn('N')}</td></tr>`;
  };
  $('#dyBody').innerHTML = (ctx.head || '') + `<div class="sec"><h2>Your ${S.year}-${String(S.year + 1).slice(2)} schedule</h2><span class="n">${esc(confLabel(I.conf))} plays <b>${I.confGames}</b> league games. The rest is yours to build: about ${I.target} non-league games, events included.</span></div>
    <div class="pg-kv"><div><span>League games</span><b>${I.confGames}</b></div><div><span>Event</span><b>${ev === null ? 'None' : ev ? esc(ev) : 'Your AD picks'}</b></div>
      <div><span>Locked</span><b>${I.locked.length}</b></div><div><span>Your picks</span><b>${I.sched.games.length}</b></div><div><span>Open dates</span><b>${I.open}</b></div>
      <div><span>Guarantee money</span><b class="${money >= 0 ? 'up' : 'dn'}">${money >= 0 ? '+' : '−'}${m$(Math.abs(money))}</b></div><div><span>Opponents' avg power</span><b>${avgTxt}</b></div></div>
    ${msg ? `<div class="pg-d sc-msg">${esc(msg)}</div>` : ''}
    <div class="sc-grid"><div class="pg-card"><h3>Multi-team event</h3>
      <label class="sc-ev"><input type="radio" name="scEv" value="" ${ev === undefined ? 'checked' : ''}> Let my AD choose</label>
      ${evs.map(e => `<label class="sc-ev"><input type="radio" name="scEv" value="${esc(e.name)}" ${ev === e.name ? 'checked' : ''}> <b>${esc(e.name)}</b> <span class="dim">${esc(e.site)} · ${e.size} teams · ${e.games} games</span></label>`).join('')}
      <label class="sc-ev"><input type="radio" name="scEv" value="__none" ${ev === null ? 'checked' : ''}> No event <span class="dim">(schedule 3 more games yourself)</span></label></div>
    <div class="pg-card"><h3>On the schedule</h3><table class="pg-tbl"><tbody>
      ${I.locked.map(l => `<tr><td class="l">${tm(l.opp)}</td><td>${V[l.v]}</td><td class="l dim">${esc(l.why)}</td><td></td></tr>`).join('')}
      ${I.sched.games.map(g => `<tr><td class="l">${tm(g.opp)}</td><td>${V[g.v]}</td><td class="l">${KIND[g.kind] || ''}${g.pay ? ` <span class="${g.kind === 'buy' ? 'dn' : 'up'}">${g.kind === 'buy' ? '−' : '+'}$${g.pay}k</span>` : ''}${g.kind === 'hah' ? ' <span class="dim">(return game next season)</span>' : ''}</td><td><a href="#" data-rm="${esc(g.opp)}" title="Remove">✕</a></td></tr>`).join('')}
      ${!I.locked.length && !I.sched.games.length ? '<tr><td class="dim">Nothing yet.</td></tr>' : ''}</tbody></table>
      <div class="pg-d">Open dates you leave are filled by your AD the way every program schedules: top programs play a marquee game or two and host buy games; smaller schools travel for guarantee checks.</div></div></div>
    <div class="pg-d"><b>How it works.</b> <b>Home</b> against a lower-tier school is a <b>buy game</b>: you pay them a guarantee. <b>Away</b> at a bigger program is a <b>guarantee game</b>: they pay you. Against a peer, either one is a <b>home-and-home</b>: you owe the return trip next season. Bigger programs won't play a true road game at a smaller one. Guarantees move money between NIL collectives when the game is played. A tougher schedule means more losses but a better NCAA résumé.</div>
    <div class="dy-row"><input id="scQ" class="dy-input" placeholder="Find an opponent…" value="${esc(q)}">
      <select id="scT" class="dy-input"><option value="">All tiers</option>${TIER_NAME.map((n, i) => `<option value="${i}" ${tierF === String(i) ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div class="sheet-wrap"><table class="sheet dense dy-sc"><thead><tr><th class="l">Opponent</th><th class="l">League</th><th>Tier</th><th title="Last season's power rank">Power</th><th>Prestige</th><th>Miles</th><th class="l">Ask them to play</th></tr></thead><tbody>${pool.map(row).join('')}</tbody></table></div>
    <div class="dy-btns"><button class="btn" id="scGo">Start the ${S.year}-${String(S.year + 1).slice(2)} season →</button></div>`;
  bind(ctx);
}

function bind(ctx) {
  const S = ctx.get(), $ = ctx.$;
  const again = () => { ctx.autosave(); scheduleStep(ctx); };
  document.querySelectorAll('input[name="scEv"]').forEach(r => r.onchange = () => { chooseEvent(S, r.value === '' ? undefined : r.value === '__none' ? null : r.value); msg = ''; again(); });
  document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { const [o, v] = b.dataset.add.split('|'); msg = addGame(S, o, v).msg; again(); });
  document.querySelectorAll('[data-rm]').forEach(a => a.onclick = e => { e.preventDefault(); removeGame(S, a.dataset.rm); msg = ''; again(); });
  $('#scQ').oninput = e => { q = e.target.value.toLowerCase().trim(); clearTimeout(bind.t); bind.t = setTimeout(() => { scheduleStep(ctx); const i = $('#scQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
  $('#scT').onchange = e => { tierF = e.target.value; scheduleStep(ctx); };
  $('#scGo').onclick = () => { msg = ''; ctx.startSeason(); };
}
