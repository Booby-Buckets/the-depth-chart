// Offseason steps 1-2: the coaching carousel (your job, offers, then every opening filled with the cascade) and the
// staff market (re-sign, hire free agents, poach assistants). Rules in engine/coaching.js + engine/program.js.
import { takeJob, wantFor } from '../engine/coaching.js?v=54';
import { finishCarousel, finishStaff } from '../engine/offseason.js?v=54';
import { record_, power } from '../engine/season.js?v=54';
import { effOvr } from '../engine/league.js?v=54';
import { ROLES, payroll, staffAsk, offerStaff, poachAsk, poachStaff, fire } from '../engine/program.js?v=54';
import { confLabel } from '../engine/awards.js?v=54';

const m$ = k => '$' + (k >= 1000 ? (k / 1000).toFixed(2) + 'M' : Math.round(k) + 'k');
const WHY = { fired: 'fired', retired: 'retired', left: 'left' };

export function carouselStep(ctx) {
  const S = ctx.get(), { esc, $, short, tm } = ctx, U = S.user, J = S.job, C = S.carousel, h = S.history.at(-1);
  const L = J.log && J.log.at(-1);
  const verdict = L ? (L.perf > 1 ? 'Well above expectations' : L.perf > 0.2 ? 'Above expectations' : L.perf > -0.2 ? 'Met expectations' : L.perf > -1 ? 'Below expectations' : 'Well below expectations') : '';
  const pw = power(S), rank = Object.fromEntries(Object.keys(pw).sort((a, b) => pw[b] - pw[a]).map((t, i) => [t, i + 1]));
  const leaving = S.off.leaving || {};
  const next = t => { const o = S.teams[t].players.map(id => S.players[id]).filter(p => p && !leaving[p.id]).map(p => effOvr(p, S)).sort((a, b) => b - a).slice(0, 8); return o.length ? Math.round(o.reduce((a, b) => a + b, 0) / o.length) : 0; };
  const staffAvg = t => { const s = Object.values(S.teams[t].prog.staff).filter(Boolean); return s.length ? Math.round(s.reduce((a, x) => a + x.r, 0) / s.length) : 0; };
  const card = t => {
    const T = S.teams[t], r = record_(S, t), o = (C && C.open.find(x => x.team === t)) || {};
    const row = (l, a, b) => `<tr><td class="l">${l}</td><td>${a}</td><td><b>${b}</b></td></tr>`;
    return `<div class="pg-card cr-offer"><div class="pg-h"><h3>${tm(t)}</h3><span class="pg-n">${esc(confLabel(T.conf))}${o.why ? ` · the coach was ${WHY[o.why]}` : ''}</span></div>
      <table class="pg-tbl"><thead><tr><th class="l"></th><th>${esc(short(U))}</th><th>${esc(short(t))}</th></tr></thead><tbody>
      ${row('Prestige', S.teams[U].prestige, T.prestige)}${row('Last season', `${record_(S, U).w}-${record_(S, U).l} (#${rank[U]})`, `${r.w}-${r.l} (#${rank[t]})`)}
      ${row('Returning top-8 OVR', next(U), next(t))}${row('NIL collective', m$(S.teams[U].prog.nil.fund), m$(T.prog.nil.fund))}
      ${row('Staff budget', m$(S.teams[U].prog.budget), m$(T.prog.budget))}${row('Staff quality', staffAvg(U), staffAvg(t))}</tbody></table>
      <div class="dy-btns"><button class="btn" data-take="${esc(t)}">Take the ${esc(short(t))} job</button></div></div>`;
  };
  let html = (ctx.head || '') + `<div class="dy-next"><div class="lbl">${S.year - 1}-${String(S.year).slice(2)} in review</div><div class="mu">${esc(short(U))} ${h.user.w}-${h.user.l} · ${esc(h.user.post)} · final power #${h.user.rank}</div>
    <div class="ln">Champion: ${tm(h.champ)} · Prestige now ${S.teams[U].prestige}/100${h.awards && h.awards.poy ? ` · National POY: ${esc(h.awards.poy.name)} (${esc(short(h.awards.poy.team))})` : ''}</div></div>
    <div class="dy-next dy-job${J.fired ? ' fired' : ''}"><div class="lbl">${J.fired ? 'You have been fired' : 'Your job'}</div>
      <div class="ln">${L ? `${verdict}: the preseason roster rating had you #${L.pre}, you finished #${L.fin}. ` : ''}Job security <b>${J.security}</b>/100 · Coaching reputation <b>${J.rep ?? '—'}</b> <span class="dim">(an AD at a program of prestige P wants about ${Math.round(wantFor(50))} at P 50, ${Math.round(wantFor(80))} at P 80)</span></div></div>`;
  if (!C) { $('#dyBody').innerHTML = html + '<div class="dy-btns"><button class="btn" id="crNext">Continue →</button></div>'; $('#crNext').onclick = () => { finishCarousel(S); S.off.step = 'staff'; ctx.autosave(); ctx.render(); }; return; }
  if (!C.done) {
    const offers = (J.offers || []).filter(t => S.teams[t]);
    html += `<div class="sec"><h2>The coaching carousel</h2><span class="n">${C.open.length} opening${C.open.length === 1 ? '' : 's'}: ${C.open.filter(o => o.why === 'fired').length} fired, ${C.open.filter(o => o.why === 'retired').length} retired — more open as coaches move up</span></div>
      ${offers.length ? `<div class="pg-d">${J.fired ? '<b>These programs will hire you — pick one to continue.</b>' : '<b>Programs that want to interview you.</b> Take a job, or stay where you are.'}</div><div class="cr-grid">${offers.map(card).join('')}</div>`
        : `<div class="pg-d">${J.fired ? 'No offers yet.' : 'No offers this year — bigger programs call when your reputation reaches what they want in a coach and they have an opening.'}</div>`}
      <div class="sheet-wrap"><table class="sheet dense"><thead><tr><th class="l">Opening</th><th class="l">League</th><th>Prestige</th><th class="l">Previous coach</th></tr></thead><tbody>
      ${C.open.slice().sort((a, b) => S.teams[b.team].prestige - S.teams[a.team].prestige).map(o => `<tr class="${offers.includes(o.team) ? 'me' : ''}"><td class="l">${tm(o.team)}</td><td class="l dim">${esc(confLabel(S.teams[o.team].conf))}</td><td>${S.teams[o.team].prestige}</td><td class="l">${esc(o.prev || '')} <span class="dim">(${WHY[o.why]}${o.buyout ? `, $${o.buyout}k buyout` : ''})</span></td></tr>`).join('')}</tbody></table></div>
      <div class="dy-btns"><button class="btn" id="crRun" ${J.fired ? 'disabled title="Pick your next job first"' : ''}>${offers.length ? `Stay at ${esc(short(U))} — run the carousel →` : 'Run the carousel →'}</button></div>`;
  } else {
    const KIND = { hc: 'moved up from', asst: 'assistant at', pool: 'back after being fired', new: 'new hire' };
    html += `<div class="sec"><h2>The coaching carousel</h2><span class="n">${C.hires.length} hires · ${C.hires.filter(x => x.kind === 'hc').length} coaches moved up · ${C.hires.filter(x => x.kind === 'asst').length} assistants got their first job</span></div>
      <div class="sheet-wrap"><table class="sheet dense"><thead><tr><th class="l">Program</th><th class="l">New coach</th><th>OVR</th><th class="l">From</th><th class="l">Replaces</th></tr></thead><tbody>
      ${C.hires.slice().sort((a, b) => S.teams[b.team].prestige - S.teams[a.team].prestige).map(x => `<tr class="${x.team === U || x.from === U ? 'me' : ''}"><td class="l">${tm(x.team)}</td><td class="l"><b>${esc(x.name)}</b></td><td>${x.r}</td><td class="l">${x.from ? `${KIND[x.kind]} ${tm(x.from)}` : `<span class="dim">${KIND[x.kind]}</span>`}</td><td class="l dim">${esc(x.prev || '')} (${WHY[x.why]})</td></tr>`).join('')}</tbody></table></div>
      <div class="dy-btns"><button class="btn" id="crNext">Staff hiring →</button></div>`;
  }
  $('#dyBody').innerHTML = html;
  document.querySelectorAll('[data-take]').forEach(b => b.onclick = () => {
    const t = b.dataset.take;
    if (!confirm(`Take the ${short(t)} job? You'll leave ${short(S.user)} and take over ${short(t)}'s roster, staff and collective.`)) return;
    takeJob(S, t); ctx.resetCache(); ctx.autosave(); ctx.render();
  });
  const run = $('#crRun'); if (run) run.onclick = () => { finishCarousel(S); ctx.autosave(); ctx.render(); };
  const nx = $('#crNext'); if (nx) nx.onclick = () => { finishCarousel(S); S.off.step = 'staff'; ctx.autosave(); ctx.render(); };
}

// ── the staff market ──
let role = '', poachRole = 'OC', msg = {};
export function staffStep(ctx) {
  const S = ctx.get(), { esc, $, short, tm } = ctx, U = S.user, P = S.teams[U].prog, M = S.staffMarket;
  if (!M || !M.open) { finishCarousel(S); }
  const pool = (S.staffMarket.pool || []).filter(s => !role || s.role === role).sort((a, b) => b.r - a.r).slice(0, 80);
  const RN = Object.fromEntries(ROLES.map(([k, l]) => [k, l]));
  const room = P.budget - payroll(P);
  const tag = s => s.mine ? '<span class="chip">your staff</span>' : s.exHC ? '<span class="chip">ex-head coach</span>' : s.young ? '<span class="chip new">rising</span>' : '';
  const offerCell = (key, ask) => `<input type="number" class="dy-min" min="0" step="5" value="${ask}" data-pay="${esc(key)}"> <select class="dy-min" data-yrs="${esc(key)}">${[1, 2, 3, 4].map(y => `<option ${y === 3 ? 'selected' : ''}>${y}</option>`).join('')}</select> yrs`;
  // the best assistants elsewhere in one role, to poach
  const poach = Object.values(S.teams).filter(t => t.name !== U && t.prog && t.prog.staff[poachRole]).map(t => ({ t, s: t.prog.staff[poachRole] }))
    .sort((a, b) => b.s.r - a.s.r).slice(0, 25);
  $('#dyBody').innerHTML = (ctx.head || '') + `<div class="sec"><h2>Staff hiring</h2><span class="n">Payroll ${m$(payroll(P))} of a ${m$(P.budget)} budget · ${m$(Math.max(0, room))} to spend</span></div>
    <div class="sheet-wrap"><table class="sheet dense"><thead><tr><th class="l">Role</th><th class="l">Coach</th><th>Age</th><th>Rating</th><th>Salary</th><th>Years left</th><th></th></tr></thead><tbody>
    ${ROLES.map(([k, l]) => { const s = P.staff[k]; return `<tr><td class="l">${l}</td><td class="l">${s ? `<b>${esc(s.name)}</b>` : '<span class="dn">Empty — hire someone</span>'}</td><td>${s ? s.age || '' : ''}</td><td>${s ? `<b>${s.r}</b>` : ''}</td><td>${s ? m$(s.pay) : ''}</td><td>${s ? s.yrs : ''}</td><td>${s ? `<button class="btn ghost pg-sm" data-rel="${k}">Release</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>
    <div class="pg-d">Better coordinators cover more of each area for you (practice, recruiting, development, NIL), so your own hours go further. Young assistants are cheaper and still improving; veterans past their mid-50s start to slip. Good coaches want a good job: a smaller program pays more to land them.</div>
    <div class="sec"><h2>On the market</h2><select id="stRole" class="dy-input sm"><option value="">All roles</option>${ROLES.map(([k, l]) => `<option value="${k}" ${k === role ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="sheet-wrap"><table class="sheet dense heat"><thead><tr><th class="l">Coach</th><th class="l">Role</th><th>Age</th><th data-heat="1">Rating</th><th>Asks</th><th class="l">Your offer</th><th></th><th class="l"></th></tr></thead><tbody>
    ${pool.map(s => { const ask = staffAsk(S, s); return `<tr><td class="l"><b>${esc(s.name)}</b> ${tag(s)}${s.from && !s.mine ? ` <span class="dim">last at ${esc(short(s.from))}</span>` : ''}</td><td class="l">${s.role}</td><td>${s.age || ''}</td><td>${s.r}</td><td>${m$(ask)}</td>
      <td class="l">${offerCell(s.id, ask)}</td><td><button class="btn ghost pg-sm" data-offer="${esc(s.id)}">Offer</button></td><td class="l rv-st">${msg[s.id] ? esc(msg[s.id]) : ''}</td></tr>`; }).join('')}</tbody></table></div>
    <div class="sec"><h2>Poach an assistant</h2><select id="stPoach" class="dy-input sm">${ROLES.map(([k, l]) => `<option value="${k}" ${k === poachRole ? 'selected' : ''}>${l}s</option>`).join('')}</select></div>
    <div class="pg-d">Pry a coach away from his program with a raise — more if his school is bigger than yours or he has years left on his deal.</div>
    <div class="sheet-wrap"><table class="sheet dense"><thead><tr><th class="l">Coach</th><th class="l">Program</th><th>Age</th><th>Rating</th><th>Salary</th><th>It'd take</th><th class="l">Your offer</th><th></th><th class="l"></th></tr></thead><tbody>
    ${poach.map(({ t, s }) => { const ask = poachAsk(S, t.name, poachRole), key = t.name + '|' + poachRole; return `<tr><td class="l"><b>${esc(s.name)}</b></td><td class="l">${tm(t.name)}</td><td>${s.age || ''}</td><td>${s.r}</td><td>${m$(s.pay)}</td><td>${m$(ask)}</td>
      <td class="l">${offerCell(key, ask)}</td><td><button class="btn ghost pg-sm" data-poach="${esc(key)}">Offer</button></td><td class="l rv-st">${msg[key] ? esc(msg[key]) : ''}</td></tr>`; }).join('')}</tbody></table></div>
    <div class="dy-btns"><button class="btn" id="stNext">Done hiring — the rest of the market signs elsewhere →</button></div>`;
  if (window.tdcSheetHeat) document.querySelectorAll('#dyBody table.heat').forEach(x => window.tdcSheetHeat(x));
  const again = () => { ctx.touch(); ctx.autosave(); staffStep(ctx); };
  const val = (k, a) => document.querySelector(`[data-${a}="${CSS.escape(k)}"]`).value;
  document.querySelectorAll('[data-offer]').forEach(b => b.onclick = () => { const k = b.dataset.offer; msg[k] = offerStaff(S, k, val(k, 'pay'), val(k, 'yrs')).msg; again(); });
  document.querySelectorAll('[data-poach]').forEach(b => b.onclick = () => { const k = b.dataset.poach, [t, r] = k.split('|'); msg[k] = poachStaff(S, t, r, val(k, 'pay'), val(k, 'yrs')).msg; again(); });
  document.querySelectorAll('[data-rel]').forEach(b => b.onclick = () => {
    if (!confirm('Release this coach? He goes on the market and the seat is empty until you hire.')) return;
    const s = P.staff[b.dataset.rel]; fire(S, b.dataset.rel);
    if (s) S.staffMarket.pool.push(Object.assign(s, { ask: s.pay, from: U, mine: false })); again();
  });
  $('#stRole').onchange = e => { role = e.target.value; staffStep(ctx); };
  $('#stPoach').onchange = e => { poachRole = e.target.value; staffStep(ctx); };
  $('#stNext').onclick = () => {
    if (ROLES.some(([k]) => !P.staff[k]) && !confirm('You have an empty seat on your staff. Continue anyway? (You can fill it later from the leftover candidates on the Program tab.)')) return;
    msg = {}; finishStaff(S); ctx.autosave(); ctx.render();
  };
}
