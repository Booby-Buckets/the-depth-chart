// Coaches tab: every head coach in the league (ratings, career, tenure, hot seat) + the latest carousel.
import { hotNow } from '../engine/coaching.js?v=48';
import { confLabel } from '../engine/awards.js?v=48';

let sortK = 'hot', conf = '', dir = 1;
export function coachesView(ctx) {
  const S = ctx.get(), { esc, $, short, tm } = ctx, U = S.user;
  const hot = S.phase === 'regular' || S.phase === 'conftourney' || S.phase === 'ncaa' ? hotNow(S) : Object.fromEntries(Object.keys(S.teams).map(t => [t, (S.teams[t].coach && S.teams[t].coach.hot) || 0]));
  const rows = Object.values(S.teams).filter(t => t.coach && (!conf || t.conf === conf)).map(t => ({ t, c: t.coach, h: hot[t.name] || 0 }));
  const key = { hot: x => x.h, r: x => -(x.c.r || 0), age: x => -(x.c.age || 0), yrs: x => -(x.c.yrs || 0), wins: x => -((x.c.car && x.c.car.w) || 0), ncaa: x => -((x.c.car && x.c.car.ncaa) || 0), pres: x => -(x.t.prestige || 0) }[sortK];
  rows.sort((a, b) => (key(a) - key(b)) * dir);
  const seat = h => h < -2 ? '<span class="dn">🔥🔥 Scorching</span>' : h < -1.2 ? '<span class="dn">🔥 Hot</span>' : h < -0.4 ? '<span class="dim">Warm</span>' : h > 1.2 ? '<span class="up">Rising star</span>' : '<span class="dim">Safe</span>';
  const confs = [...new Set(Object.values(S.teams).map(t => t.conf))].sort((a, b) => confLabel(a).localeCompare(confLabel(b)));
  const C = S.carousel;
  const th = (k, l, t = '') => `<th class="${k === 'r' || k === 'hot' ? '' : ''} so" data-so="${k}" title="${esc(t)}">${l}${sortK === k ? (dir > 0 ? ' ▾' : ' ▴') : ''}</th>`;
  $('#dyBody').innerHTML = `<div class="sec"><h2>Head coaches</h2><span class="n">Ratings: overall, offense, defense, recruiting, player development. An AI coach's ratings, against what a program of his stature usually has, move how well it practices, recruits and develops.</span></div>
    <div class="dy-row"><select id="coConf" class="dy-input"><option value="">All conferences</option>${confs.map(c => `<option value="${esc(c)}" ${c === conf ? 'selected' : ''}>${esc(confLabel(c))}</option>`).join('')}</select></div>
    <div class="sheet-wrap"><table class="sheet dense heat dy-co"><thead><tr><th class="l">Program</th><th class="l">Coach</th>${th('age', 'Age')}<th data-heat="1">${'OVR'}</th><th data-heat="1">OFF</th><th data-heat="1">DEF</th><th data-heat="1">REC</th><th data-heat="1">DEV</th>
      ${th('yrs', 'Yrs', 'Seasons at this program')}${th('wins', 'Career W-L', 'Since the dynasty began')}${th('ncaa', 'NCAA', 'NCAA tournaments / Final Fours / titles')}<th>Contract</th>${th('hot', 'Hot seat', 'Last season vs expectations, plus this season so far')}</tr></thead><tbody>
    ${rows.slice(0, 400).map(({ t, c, h }) => { const car = c.car || {}; const me = c.user; return `<tr class="${me ? 'me' : ''}"><td class="l">${tm(t.name)}</td><td class="l"><b>${esc(c.name)}</b>${me ? ' <span class="chip">you</span>' : ''}</td><td>${c.age || ''}</td>
      <td>${me ? '' : c.r ?? ''}</td><td>${me ? '' : c.off ?? ''}</td><td>${me ? '' : c.def ?? ''}</td><td>${me ? '' : c.rec ?? ''}</td><td>${me ? '' : c.dev ?? ''}</td>
      <td>${c.yrs || 0}</td><td>${car.w || 0}-${car.l || 0}</td><td>${car.ncaa || 0}${car.ff ? ` / ${car.ff} FF` : ''}${car.titles ? ` / ${car.titles} 🏆` : ''}</td><td>${me ? '' : c.cont != null ? `${c.cont} yr${c.cont === 1 ? '' : 's'}` : ''}</td><td class="l">${me ? `security ${S.job.security}` : seat(h)}</td></tr>`; }).join('')}</tbody></table></div>
    ${C && C.done ? `<div class="sec"><h2>${C.year} carousel</h2><span class="n">${C.hires.length} hires</span></div><div class="pg-d">${C.hires.slice().sort((a, b) => S.teams[b.team].prestige - S.teams[a.team].prestige).slice(0, 30).map(x => `${tm(x.team)} ${esc(x.name)}${x.from ? ` <span class="dim">(from ${esc(short(x.from))})</span>` : ''}`).join(' · ')}</div>` : ''}`;
  if (window.tdcSheetHeat) document.querySelectorAll('#dyBody table.heat').forEach(x => window.tdcSheetHeat(x));
  document.querySelectorAll('[data-so]').forEach(h => h.onclick = () => { const k = h.dataset.so; if (k === sortK) dir = -dir; else { sortK = k; dir = 1; } coachesView(ctx); });
  $('#coConf').onchange = e => { conf = e.target.value; coachesView(ctx); };
}
