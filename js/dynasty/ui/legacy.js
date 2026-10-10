// Coach tab: the Coaching Legacy (level, points, the three disciplines' traits) + the Trophy Room + where the legacy
// came from. Rules in engine/legacy.js / engine/history.js.
import { DISCIPLINES, TRAITS, MAX_RANK, MAX_LEVEL, ensureLegacy, rank, cost, buyTrait, lpFor, pct } from '../engine/legacy.js?v=54';

const KINDS = [['title', 'National titles', '🏆'], ['ff', 'Final Fours', '🏀'], ['conf', 'Conference titles', '🥇'], ['event', 'Event titles', '🏝️'], ['nit', 'NIT / CBI titles', '🎖️'],
  ['rivalry', 'Rivalry wins', '⚔️'], ['coach', 'Coach awards', '📋'], ['award', 'Player awards', '⭐']];

export function legacyView(ctx) {
  const S = ctx.get(), { esc, $, short, tm } = ctx, L = ensureLegacy(S), me = S.teams[S.user].coach;
  const T = S.trophies || [];
  const fill = (txt, v) => txt.replace(/\{(\d+)\}/, () => (v < 1 ? Math.round(v * 100) : v));
  const traitCard = k => {
    const t = TRAITS[k], r = rank(S, k), c = cost(S, k);
    const pips = Array.from({ length: MAX_RANK }, (_, i) => `<i class="${i < r ? 'on' : ''}"></i>`).join('');
    return `<div class="lg-t ${r ? 'own' : ''}"><div class="lg-n"><b>${esc(t.name)}</b><span class="lg-p">${pips}</span></div>
      <div class="lg-d">${esc(fill(t.per, t.v[Math.min(r, MAX_RANK - 1)]))}${r && r < MAX_RANK ? ` <span class="dim">(now: ${esc(fill(t.per, t.v[r - 1]).split('.')[0])})</span>` : ''}</div>
      ${r < MAX_RANK ? `<button class="btn ghost pg-sm" data-buy="${k}" ${L.pts < c ? 'disabled' : ''}>${r ? 'Rank up' : 'Learn'} · ${c} pt${c > 1 ? 's' : ''}</button>` : '<span class="up">Mastered</span>'}</div>`;
  };
  const cnt = k => T.filter(x => x.kind === k).length;
  const H = S.history || [];
  const car = me && me.car ? me.car : { w: 0, l: 0 };
  $('#dyBody').innerHTML = `<div class="sec"><h2>Coach ${esc(me ? me.name : '')}</h2><span class="n">${H.length} season${H.length === 1 ? '' : 's'} · ${car.w || 0}-${car.l || 0} · ${car.ncaa || 0} NCAA tournament${car.ncaa === 1 ? '' : 's'}</span></div>
    <div class="pg-card lg-head"><div class="lg-lv"><span>Coach level</span><b>${L.level}</b><em>of ${MAX_LEVEL}</em></div>
      <div class="lg-bar"><div class="pg-d">Legacy ${L.lp.toLocaleString()}${L.level < MAX_LEVEL ? ` · next level at ${lpFor(L.level + 1).toLocaleString()}` : ''}</div><span class="pg-bar"><i style="width:${Math.round(100 * pct(L))}%;background:var(--accent,#c9a227)"></i></span></div>
      <div class="lg-lv"><span>Points to spend</span><b>${L.pts}</b></div></div>
    <div class="pg-d">Your coaching legacy grows with what you win: games, league titles, March, players you send to the draft, awards, top recruiting classes, beating expectations. Every coach level is a point to spend on a trait. Nobody masters everything — choose who you want to be.</div>
    <div class="lg-cols">${DISCIPLINES.map(([d, l]) => `<div><h3>${esc(l)}</h3>${Object.keys(TRAITS).filter(k => TRAITS[k].d === d).map(traitCard).join('')}</div>`).join('')}</div>
    <div class="sec"><h2>Trophy room</h2><span class="n">${T.length} trophies</span></div>
    <div class="lg-tro">${KINDS.map(([k, l, i]) => `<div><span>${i}</span><b>${cnt(k)}</b><em>${l}</em></div>`).join('')}</div>
    ${T.length ? `<div class="sheet-wrap"><table class="sheet dense"><thead><tr><th class="l">Season</th><th class="l">Trophy</th><th class="l">Program</th><th></th></tr></thead><tbody>
      ${T.slice().reverse().slice(0, 120).map(x => `<tr><td class="l">${x.y - 1}-${String(x.y).slice(2)}</td><td class="l">${(KINDS.find(k => k[0] === x.kind) || ['', '', '🏆'])[2]} ${esc(x.name).replace(/\[\[([^\]]+)\]\]/g, (m, t) => esc(short(t)))}</td><td class="l">${tm(x.team)}</td><td class="dim">${esc(x.score || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="dy-empty">Win something — rivalry games, events, league titles and March all go on the shelf.</div>'}
    <div class="sec"><h2>Where your legacy came from</h2></div>
    <div class="pg-d lg-log">${L.log.slice().reverse().slice(0, 40).map(x => x.up ? `<b class="up">${esc(x.why)}</b>` : `${x.y - 1}-${String(x.y).slice(2)} · ${esc(x.why)} <b>+${x.n}</b>`).join('<br>') || 'Nothing yet.'}</div>`;
  document.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => { const e = buyTrait(S, b.dataset.buy); if (e) alert(e); ctx.touch(); ctx.autosave(); legacyView(ctx); });
}
