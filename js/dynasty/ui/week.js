// "This week" (Oct 2026, owner: "you need week to week tasks, not just tasks to do"): the home screen opens with a
// checklist rebuilt every week from the save — what needs doing now, why, and a button straight to it. The old home
// panel (next game, sims, results, news, top 10) follows underneath.
import { HOURS, AREAS, OFF, DEF, fitOf } from '../engine/program.js?v=55';
import { classNeed, commitsOf, cutWeeks, hoursBudget, hoursUsed, planHours, rankOf, SUMMER, STAGE_LABEL } from '../engine/commits.js?v=55';
import { visitsLeft, upcomingHomeGames } from '../engine/visits.js?v=55';

const KIND = { must: ['Must', 'must'], rec: ['Recommended', 'rec'], done: ['Done', 'done'] };

/** the week's tasks: [{ kind: must|rec|done, title, why, go: tab, btn }] */
export function weekTasks(S, short) {
  const U = S.user, t = S.teams[U], P = t.prog, out = [];
  const add = (kind, title, why, go, btn) => out.push({ kind, title, why, go, btn });
  const today = S.progT || (S.schedule.find(g => !g.r) || {}).d || '';
  const in7 = d => d && today && (Date.parse(d) - Date.parse(today)) / 864e5 <= 7;
  const fmt = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  // hours
  const used = AREAS.reduce((s, [a]) => s + (P.hours[a] || 0), 0);
  if (used < HOURS) add('must', `Assign your weekly hours (${HOURS - used} unused)`, 'Unassigned hours do nothing — pick a plan on the Practice screen.', 'program', 'Set hours');
  else add('done', 'Weekly hours set', AREAS.map(([a, l]) => `${l.split(' ')[0].toLowerCase()} ${P.hours[a]}`).join(' · '), 'program', 'Change');
  // the recruiting race
  const R = S.rclass || [];
  if (R.length && R[0].list && S.phase !== 'offseason') {
    const mine = R.filter(r => r.list.includes(U) && !r.signed), w = S.rweek || 0;
    const need = classNeed(S, U), have = commitsOf(S, U).length;
    const nextCut = Object.entries(cutWeeks).find(([, v]) => v > w);
    if (nextCut && nextCut[1] - w <= 1) {
      const size = { t8: 8, t5: 5, t3: 3 }[nextCut[0]];
      const danger = mine.filter(r => !r.commit && r.list.length > size && rankOf(r, U) > size);
      if (danger.length) add('must', `${danger.length} recruit${danger.length === 1 ? ' is' : 's are'} about to cut you`, `They cut to a ${STAGE_LABEL[nextCut[0]]} this week and you're outside it: ${danger.slice(0, 3).map(r => r.name).join(', ')}${danger.length > 3 ? '…' : ''}. Put hours on them or let them go.`, 'recruit', 'Recruiting');
    }
    if (have < need && mine.filter(r => r.stage === 'open').length + have < need * 2 && R.some(r => r.stage === 'open' && !r.list.includes(U)))
      add('rec', `Offer more recruits (${mine.length} out, ${need - have} spot${need - have === 1 ? '' : 's'} to fill)`, 'Recruits only consider schools that offered them — and once they cut to a Top 8 it is too late.', 'recruit', 'Find recruits');
    const unplanned = mine.filter(r => !planHours((S.rplan || {})[r.id]) && !r.commit);
    const left = hoursBudget(S) - hoursUsed(S);
    if (w > SUMMER && unplanned.length && left >= 10) add('rec', `Spend this week's recruiting hours (${left} left)`, `${unplanned.length} recruit${unplanned.length === 1 ? '' : 's'} on your board with no plan — your staff only covers part of it.`, 'recruit', 'Plan hours');
    const home = upcomingHomeGames(S).find(g => in7(g.d));
    if (home && visitsLeft(S) > 0 && !(S.visits || []).some(v => v.gid === home.id))
      add('rec', `Bring a recruit to ${fmt(home.d)} vs ${short(home.a)}`, `${visitsLeft(S)} official visits left — a home win in front of a recruit is your strongest pitch.`, 'recruit', 'Pick a recruit');
    const counters = R.filter(r => r.nilState === 'counter');
    if (counters.length) add('must', `${counters.length} NIL counter-offer${counters.length === 1 ? '' : 's'} waiting`, counters.map(r => `${r.name} wants $${r.counter}k`).join(' · '), 'recruit', 'Answer');
    const shaky = R.filter(r => r.commit === U && !r.signed && r.list.some(x => x !== U && (r.int[x] || 0) > 0.85 * (r.int[U] || 1)));
    if (shaky.length) add('rec', `Keep ${shaky.length === 1 ? shaky[0].name : shaky.length + ' commits'} locked in`, 'A rival is within 15% of your interest — keep working him or he can flip.', 'recruit', 'Recruiting');
    if (have) add('done', `${have} commit${have === 1 ? '' : 's'} in your class`, R.filter(r => (r.signed || r.commit) === U).map(r => `${r.name} (${r.stars}★)`).join(', '), 'recruit', 'View');
  }
  // the roster
  const hurt = t.players.map(id => S.players[id]).filter(p => p && p.out > 0 && (p.mpg || 0) >= 15);
  if (hurt.length) add('rec', `${hurt.map(p => p.name).join(', ')} ${hurt.length === 1 ? 'is' : 'are'} out — check your rotation`, hurt.map(p => `${p.name}: ${p.inj ? p.inj.type : 'injury'}, ${p.out >= 99 ? 'season' : p.out + ' game' + (p.out === 1 ? '' : 's')}`).join(' · '), 'roster', 'Rotation');
  // the next game
  const next = S.schedule.filter(g => !g.r && (g.h === U || g.a === U)).sort((a, b) => (a.d < b.d ? -1 : 1))[0];
  if (next && in7(next.d)) { const opp = next.h === U ? next.a : next.h; add('rec', `Game plan for ${short(opp)} (${fmt(next.d)})`, 'Tempo, the three-point line, pressure and who to key on — set it before the game.', 'plan', 'Game plan'); }
  // schemes: is there a much better fit on the board?
  for (const [side, SET, cur, nm] of [['o', OFF, P.off, 'offense'], ['d', DEF, P.def, 'defense']]) {
    const best = Object.keys(SET).map(k => [k, fitOf(S, t, side, k)]).sort((a, b) => b[1] - a[1])[0];
    if (best[0] !== cur && best[1] - fitOf(S, t, side, cur) >= 0.25) add('rec', `Your roster fits ${SET[best[0]].label} on ${nm}`, `Better fit than ${SET[cur].label} — switching starts the new scheme from what your players already know.`, 'program', 'Practice');
  }
  const order = { must: 0, rec: 1, done: 2 };
  return out.sort((a, b) => order[a.kind] - order[b.kind]);
}

export const WEEK_CSS = `.wk-box{border:1px solid var(--border);border-radius:10px;overflow:hidden;margin:4px 0 18px}
.wk-h{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border);font-weight:800;font-size:13px;letter-spacing:.05em;text-transform:uppercase}
.wk-h span{font-weight:600;letter-spacing:0;text-transform:none;color:var(--text3)}
.wk-t{display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border)}
.wk-t:last-child{border-bottom:0}.wk-ck{width:18px;height:18px;border-radius:50%;border:2px solid var(--border2);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#fff}
.wk-t.must .wk-ck{border-color:var(--red,#cc2200)}.wk-t.done .wk-ck{background:var(--green,#1a8c3a);border-color:var(--green,#1a8c3a)}
.wk-t.done b{color:var(--text3)}.wk-t .why{font-size:12px;color:var(--text3);margin-top:1px}
.wk-tag{font-size:9.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:2px 6px;border-radius:4px;margin-left:8px;vertical-align:1px}
.wk-tag.must{background:hsla(0,70%,48%,.18);color:var(--red,#cc2200)}.wk-tag.rec{background:hsla(45,80%,50%,.2)}.wk-tag.done{background:var(--bg3,#eee);color:var(--text3)}`;

export function weekBox(S, esc, short) {
  const T = weekTasks(S, short), open = T.filter(x => x.kind !== 'done').length;
  const wk = Math.max(0, (S.rweek || 0) - SUMMER);
  return `<div class="wk-box"><div class="wk-h">${S.phase === 'regular' ? `Week ${wk || 1} to-do` : 'To-do'}<span>${open ? `${open} open` : 'all caught up'} · rebuilt every week</span></div>
    ${T.map(x => `<div class="wk-t ${x.kind}"><span class="wk-ck">${x.kind === 'done' ? '✓' : ''}</span><div><b>${esc(x.title)}</b><span class="wk-tag ${KIND[x.kind][1]}">${KIND[x.kind][0]}</span><div class="why">${esc(x.why)}</div></div>
      <button class="btn ${x.kind === 'must' ? '' : 'ghost'} pg-sm" data-go="${x.go}">${esc(x.btn)}</button></div>`).join('') || '<div class="wk-t"><span></span><div class="dim">Nothing to do — play the week.</div></div>'}</div>`;
}
export function openTasks(S, short) { try { return weekTasks(S, short).filter(x => x.kind !== 'done').length; } catch (e) { return 0; } }
