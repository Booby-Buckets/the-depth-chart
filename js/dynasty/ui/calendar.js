// Dynasty calendar (Oct 9 2026): a 2K-style month grid of the season — the user's games as opponent tiles
// (logo on the opponent's colour, home / away / neutral, the result once played, MTE + TBD days), practice days
// in between — and a CRAWL that walks the season a day at a time (league-wide), stopping before the user's
// games so they can watch or sim them. The cursor (state.cal) is saved with the dynasty.
// UI-side only: drives the engine's simNext / nextDate; never touches storage itself (ctx.autosave does).
import { simNext } from '../engine/flow.js?v=48';
import { nextDate, power, lineFor } from '../engine/season.js?v=48';

const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SPEED = { slow: 650, normal: 260, fast: 70 };
const addD = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const ord = n => n + (['th', 'st', 'nd', 'rd'][n % 10 > 3 || [11, 12, 13].includes(n % 100) ? 0 : n % 10]);
const sleep = ms => new Promise(r => setTimeout(r, ms));

let crawling = false, stopReq = false, speed = 'normal', stopMine = true, viewMonth = null, target = null, lastDay = null;
try { speed = localStorage.getItem('dy_speed') || 'normal'; stopMine = localStorage.getItem('dy_stopmine') !== '0'; } catch (e) {}

export function isCrawling() { return crawling; }
export function stopCrawl() { stopReq = true; }

function cursor(S) {
  if (!S.cal) { const d = nextDate(S); S.cal = d ? addD(d, -1) : `${S.year - 1}-11-01`; }
  // games played elsewhere (Watch, Sim game, the Home buttons) move the cursor with them
  let last = null; for (const g of S.schedule) if (g.r && (!last || g.d > last)) last = g.d;
  if (last && S.cal < last) S.cal = last;
  return S.cal;
}
const userGameOn = (S, d) => S.schedule.find(g => g.d === d && (g.h === S.user || g.a === S.user));
const userPendingOn = (S, d) => (S.pending || []).find(x => x.d === d && !x.done && x.team === S.user);

export function calendarView(ctx) {
  const S = ctx.get(); if (!S) return;
  const { esc, short, logo, color, $ } = ctx;
  const cur = cursor(S);
  const ndv = nextDate(S);
  if (!viewMonth || crawling || ctx._fresh) { viewMonth = (crawling || !ndv ? cur : (ndv > cur ? ndv : cur)).slice(0, 7); ctx._fresh = false; }
  const [vy, vm] = viewMonth.split('-').map(Number);
  const first = new Date(Date.UTC(vy, vm - 1, 1)), startDow = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(vy, vm, 0)).getUTCDate();
  const pw = power(S);
  const nd = nextDate(S);
  const g0 = userGameOn(S, nd) && !userGameOn(S, nd).r ? userGameOn(S, nd) : null;
  const curD = new Date(cur + 'T12:00:00Z');
  const head = `<div class="cal-top"><div><div class="cal-eyebrow">${esc(short(S.user))} · ${S.year - 1}-${String(S.year).slice(2)}</div>
      <div class="cal-date">${MON[curD.getUTCMonth()].toUpperCase()} ${ord(curD.getUTCDate()).toUpperCase()}, ${curD.getUTCFullYear()}</div>
      <div class="cal-gd">${g0 && g0.d === addD(cur, 1) || (g0 && g0.d === cur) ? `GAME DAY: ${esc(short(g0.a))} ${g0.n ? 'vs' : '@'} ${esc(short(g0.h))}` : nd ? `Next: ${userNextTxt(S, ctx)}` : 'Season complete'}</div></div>
    <div class="cal-ctl">
      ${crawling ? '<button class="btn" id="calStop">⏸ Stop</button>' : '<button class="btn" id="calCrawl">▶ Crawl</button>'}
      <span class="cal-spd">${['slow', 'normal', 'fast'].map(s => `<button class="${s === speed ? 'on' : ''}" data-spd="${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</span>
      <label class="cal-chk"><input type="checkbox" id="calStopMine" ${stopMine ? 'checked' : ''}> Stop before my games</label>
      ${!crawling && S.schedule.some(x => !x.r && (x.h === S.user || x.a === S.user)) ? '<button class="btn ghost" id="calWatch">▶ Watch my next game</button><button class="btn ghost" id="calSimG">Sim my next game</button>' : ''}
      ${target ? `<span class="cal-tgt">Crawling to ${esc(fmtShort(target))} <a href="#" id="calTgtX">✕</a></span>` : ''}
    </div></div>`;
  const nav = `<div class="cal-nav"><button class="btn ghost" id="calPrev">‹</button><b>${MON[vm - 1]} ${vy}</b><button class="btn ghost" id="calNext">›</button>
    <span class="cal-leg"><i class="away"></i>Away <i class="home"></i>Home <i class="neu"></i>Neutral <span class="pr">📋</span> Practice</span></div>`;
  let cells = '';
  for (let i = 0; i < startDow; i++) cells += '<div class="cal-c out"></div>';
  for (let day = 1; day <= days; day++) {
    const d = `${vy}-${String(vm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const g = userGameOn(S, d), pe = !g && userPendingOn(S, d);
    const isCur = d === cur, past = d < cur, lbl = `<span class="dt">${MON[vm - 1].slice(0, 3).toUpperCase()} ${day}</span>`;
    if (g) {
      const home = g.h === S.user, opp = home ? g.a : g.h, site = g.n ? 'neu' : home ? 'home' : 'away';
      let res = '';
      if (g.r) { const us = home ? g.r[0] : g.r[1], th = home ? g.r[1] : g.r[0]; res = `<span class="res ${us > th ? 'w' : 'l'}">${us > th ? 'W' : 'L'} ${us}-${th}${g.r[2] ? ' OT' : ''}</span>`; }
      else { const sp = lineFor(S, g, pw) * (home ? 1 : -1); res = `<span class="ln">${sp >= 0 ? '−' : '+'}${Math.abs(sp).toFixed(1)}</span>`; }
      const tag = g.t === 'ct' ? 'Conf. tourney' : g.t === 'ncaa' ? 'NCAA' : g.ev ? g.ev.replace(/ · day.*/, '') : g.fill ? 'Added' : g.c ? '' : '';
      cells += `<div class="cal-c game ${site}${isCur ? ' cur' : ''}${past ? ' past' : ''}" style="--oc:${esc(color(opp))}" data-day="${d}" ${g.r && S.userBox[g.id] ? `data-box="${esc(g.id)}"` : ''} title="${esc((home ? 'vs ' : g.n ? 'vs ' : '@ ') + short(opp))}">
        ${lbl}<span class="site">${g.n ? 'N' : home ? 'H' : 'A'}</span>${logo(opp) ? `<img src="${esc(logo(opp))}" alt="" loading="lazy">` : `<span class="nm">${esc(short(opp))}</span>`}
        ${tag ? `<span class="tag">${esc(tag)}</span>` : ''}${(() => { const nV = (S.visits || []).filter(v => v.gid === g.id).length; return nV ? `<span class="vis" title="${nV} recruit${nV > 1 ? 's' : ''} on an official visit">🎓${nV > 1 ? nV : ''}</span>` : ''; })()}${res}</div>`;
    } else if (pe) {
      cells += `<div class="cal-c game neu tbd${isCur ? ' cur' : ''}" data-day="${d}">${lbl}<span class="site">N</span><span class="nm">TBD</span><span class="tag">${esc((pe.ev || 'Event').replace(/ · day.*/, ''))}</span></div>`;
    } else {
      const inSeason = d >= `${S.year - 1}-11-01` && d <= `${S.year}-04-10`;
      cells += `<div class="cal-c${isCur ? ' cur' : ''}${past ? ' past' : ''}${inSeason ? '' : ' off'}" data-day="${d}">${lbl}${inSeason ? '<span class="pr">📋</span>' : ''}</div>`;
    }
  }
  for (let i = startDow + days; i % 7; i++) cells += '<div class="cal-c out"></div>';
  const tick = ticker(S, ctx);
  $('#dyBody').innerHTML = head + nav + `<div class="cal-grid">${DOW.map(x => `<div class="cal-h">${x}</div>`).join('')}${cells}</div>` + tick +
    `<div class="cal-note">Click a future day to crawl to it · click a played game for its box score.</div>`;
  bind(ctx);
}

function fmtShort(iso) { const d = new Date(iso + 'T12:00:00Z'); return MON[d.getUTCMonth()].slice(0, 3) + ' ' + d.getUTCDate(); }
function userNextTxt(S, ctx) {
  const g = S.schedule.find(x => !x.r && (x.h === S.user || x.a === S.user));
  if (!g) return 'no games left';
  const home = g.h === S.user, opp = home ? g.a : g.h;
  return `${fmtShort(g.d)} ${g.n ? 'vs' : home ? 'vs' : '@'} ${ctx.esc(ctx.short(opp))}`;
}

// the day just simulated, as a scrolling score strip (the user's game first, then the best-rated games)
function ticker(S, ctx) {
  const d = lastDay;
  if (!d) return '<div class="cal-tick"><span class="lab">Scores</span><span class="it dim">Start the crawl to see the day\'s scores.</span></div>';
  const pw = power(S);
  const gs = S.schedule.filter(g => g.d === d && g.r).sort((a, b) => ((b.h === S.user || b.a === S.user) - (a.h === S.user || a.a === S.user)) || (Math.max(pw[b.h] ?? -99, pw[b.a] ?? -99) - Math.max(pw[a.h] ?? -99, pw[a.a] ?? -99))).slice(0, 14);
  const it = gs.map(g => { const hw = g.r[0] > g.r[1];
    return `<span class="it${g.h === S.user || g.a === S.user ? ' me' : ''}"><b class="${hw ? '' : 'w'}">${ctx.esc(ctx.short(g.a))} ${g.r[1]}</b> · <b class="${hw ? 'w' : ''}">${ctx.esc(ctx.short(g.h))} ${g.r[0]}</b>${g.r[2] ? ' OT' : ''}</span>`; }).join('');
  return `<div class="cal-tick"><span class="lab">${fmtShort(d)}</span><div class="mv">${it || '<span class="it dim">No games</span>'}</div></div>`;
}

function bind(ctx) {
  const { $ } = ctx, on = (id, f) => { const e = $('#' + id); if (e) e.onclick = f; };
  on('calCrawl', () => crawl(ctx));
  on('calStop', () => { stopReq = true; });
  on('calWatch', () => ctx.onWatch());
  on('calSimG', () => ctx.onSimGame());
  on('calTgtX', e => { e.preventDefault(); target = null; calendarView(ctx); });
  on('calPrev', () => { const [y, m] = viewMonth.split('-').map(Number); viewMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; calendarView(ctx); });
  on('calNext', () => { const [y, m] = viewMonth.split('-').map(Number); viewMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; calendarView(ctx); });
  const sm = $('#calStopMine'); if (sm) sm.onchange = () => { stopMine = sm.checked; try { localStorage.setItem('dy_stopmine', stopMine ? '1' : '0'); } catch (e) {} };
  document.querySelectorAll('.cal-spd [data-spd]').forEach(b => b.onclick = () => { speed = b.dataset.spd; try { localStorage.setItem('dy_speed', speed); } catch (e) {} calendarView(ctx); });
  document.querySelectorAll('.cal-grid [data-day]').forEach(c => c.onclick = () => {
    if (c.dataset.box) return ctx.openBox(c.dataset.box);
    const S = ctx.get(); if (crawling || c.dataset.day <= cursor(S)) return;
    target = c.dataset.day; crawl(ctx);
  });
}

// walk the calendar a day at a time; days with games are simulated league-wide
async function crawl(ctx) {
  if (crawling) return;
  crawling = true; stopReq = false;
  const C = ctx.C;
  let first = true;                    // pressing Crawl on the evening before your game plays it
  try {
    for (;;) {
      const S = ctx.get(); if (!S || stopReq) break;
      const nd = nextDate(S);
      if (!nd) { const r = simNext(S, C, ctx.cache); if (!r) break; lastDay = r.date; S.cal = r.date; calendarView(ctx); await sleep(SPEED[speed]); continue; }
      const cur = cursor(S);
      if (cur < addD(nd, -1)) {                                   // an off day: practice, move on
        S.cal = addD(cur, 1); first = false;
        if (target && S.cal >= target) { target = null; break; }
        calendarView(ctx); await sleep(SPEED[speed] / 2); continue;
      }
      // the next day has games
      const mine = userGameOn(S, nd);
      if (stopMine && mine && !mine.r && !first) { S.cal = addD(nd, -1); break; }   // stop the evening before: watch or sim it
      first = false;
      const r = simNext(S, C, ctx.cache); if (!r) break;
      lastDay = r.date; S.cal = r.date;
      ctx.autosave();
      if (target && S.cal >= target) { target = null; calendarView(ctx); break; }
      calendarView(ctx);
      await sleep(SPEED[speed]);
    }
  } finally {
    crawling = false; stopReq = false; ctx.autosave();
    if (ctx.render) ctx.render(); else calendarView(ctx);   // the header (record, power) catches up
  }
}

export function noteDay(d) { lastDay = d; }
