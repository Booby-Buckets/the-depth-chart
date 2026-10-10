// Facilities: the national ranking (Rankings tab) and the user's facilities card with building projects (Program
// tab). Rules in engine/facilities.js.
import { PARTS, PROJECTS, facRanks, facOverall, projCost, startProject, hcaMult, injuryMult, practiceMult, retainMult } from '../engine/facilities.js?v=55';
import { confLabel } from '../engine/awards.js?v=55';

let conf = '';
const m$ = k => '$' + (k >= 1000 ? (k / 1000).toFixed(2) + 'M' : Math.round(k) + 'k');

export function facilitiesRankHtml(ctx) {
  const S = ctx.get(), { esc, tm } = ctx, U = S.user;
  const all = facRanks(S), list = all.filter(x => !conf || S.teams[x.team].conf === conf);
  const confs = [...new Set(Object.values(S.teams).map(t => t.conf))].sort((a, b) => confLabel(a).localeCompare(confLabel(b)));
  return `<div class="sec"><h2>Facilities rankings</h2><span class="n">Arena (35% — seeded from real 2025-26 home crowds), practice facility, strength & medical, player amenities</span></div>
    <div class="dy-row"><select id="facConf" class="dy-input"><option value="">All conferences</option>${confs.map(c => `<option value="${esc(c)}" ${c === conf ? 'selected' : ''}>${esc(confLabel(c))}</option>`).join('')}</select></div>
    <div class="sheet-wrap"><table class="sheet dense heat dy-fac"><thead><tr><th>#</th><th class="l">Program</th><th class="l">Conf</th><th data-heat="1">Overall</th><th data-heat="1">Arena</th><th class="l">Venue</th><th title="Average home attendance, 2025-26">Crowd</th><th data-heat="1">Practice</th><th data-heat="1">Medical</th><th data-heat="1">Amenities</th><th class="l">Building</th></tr></thead><tbody>
    ${list.map(x => { const f = x.fac; return `<tr class="${x.team === U ? 'me' : ''}"><td>${x.rank}</td><td class="l">${tm(x.team)}</td><td class="l dim">${esc(confLabel(S.teams[x.team].conf))}</td><td><b>${x.overall}</b></td>
      <td>${Math.round(f.arena)}</td><td class="l dim">${esc(f.venue || '')}</td><td>${f.att ? f.att.toLocaleString() : ''}</td><td>${Math.round(f.practice)}</td><td>${Math.round(f.medical)}</td><td>${Math.round(f.amen)}</td>
      <td class="l dim">${(f.proj || []).map(p => PROJECTS[p.part].label).join(', ')}</td></tr>`; }).join('')}</tbody></table></div>`;
}
export function bindFacilitiesRank(ctx, rerender) {
  const s = ctx.$('#facConf'); if (s) s.onchange = e => { conf = e.target.value; rerender(); };
}

/** the Program tab card: your facilities, national ranks, what they do, building projects */
export function facilitiesCard(ctx) {
  const S = ctx.get(), { esc } = ctx, t = S.teams[S.user], F = t.fac;
  if (!F) return '';
  const R = facRanks(S), me = R.find(x => x.team === t.name), n = R.length;
  const eff = { arena: `home-court edge ×${hcaMult(t).toFixed(2)}`, practice: `practice ×${practiceMult(t).toFixed(2)}`, medical: `injury risk ×${injuryMult(t).toFixed(2)}`, amen: `portal temptation ×${retainMult(S, t).toFixed(2)}` };
  const building = k => (F.proj || []).find(p => p.part === k);
  return `<div class="pg-card"><div class="pg-h"><h3>Facilities</h3><span class="pg-n">#${me.rank} of ${n} nationally · overall ${me.overall}${F.venue ? ` · ${esc(F.venue)}${F.att ? `, ${F.att.toLocaleString()} a game` : ''}` : ''}</span></div>
    <table class="pg-tbl"><thead><tr><th class="l">Facility</th><th>Rating</th><th>Rank</th><th class="l">Does</th><th class="l">Build</th></tr></thead><tbody>
    ${PARTS.map(([k, l]) => { const b = building(k), P = PROJECTS[k], c = projCost(S, t, k); return `<tr><td class="l">${l}</td><td><b>${Math.round(F[k])}</b></td><td>#${me.rk[k]}</td><td class="l dim">${eff[k]}</td>
      <td class="l">${b ? `<span class="up">${esc(P.label)} — ${b.left} season${b.left > 1 ? 's' : ''} to go (+${b.gain})</span>` : `<button class="btn ghost pg-sm" data-build="${k}" ${t.prog.nil.fund < c ? 'disabled' : ''}>${esc(P.label)} · ${m$(c)} · +${P.gain}${P.seasons > 1 ? ` · ${P.seasons} seasons` : ''}</button>`}</td></tr>`; }).join('')}
    </tbody></table>
    <div class="pg-d">Projects are paid now from the NIL collective (${m$(t.prog.nil.fund)}) — donors give to buildings or to players — and open when the next season starts. Facilities age every year; programs that don't build fall behind. The overall is part of your brand in recruiting.</div></div>`;
}
export function bindFacilitiesCard(ctx, rerender) {
  const S = ctx.get();
  document.querySelectorAll('[data-build]').forEach(b => b.onclick = () => {
    const k = b.dataset.build, t = S.teams[S.user];
    if (!confirm(`${PROJECTS[k].label}: $${projCost(S, t, k)}k from your collective?`)) return;
    const e = startProject(S, k); if (e) alert(e);
    ctx.touch(); ctx.autosave(); rerender();
  });
}
