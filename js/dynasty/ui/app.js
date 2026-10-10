// Dynasty — the page. Engine (pure) + browser saves + rendering. One league in memory (S); every action
// mutates it through the engine, re-renders, and autosaves.
import { C } from '../engine/constants.js?v=52';
import { createLeague, hydrate, dehydrate, YR_LABEL, effOvr } from '../engine/league.js?v=52';
import { overall } from '../engine/ratings.js?v=52';
import { prepared, playGame, record, gameSeed, nextDate, power, poll, standings, record_, lineFor, touch } from '../engine/season.js?v=52';
import { simNext, simTo, afterDay } from '../engine/flow.js?v=52';
import { postResult } from '../engine/postseason.js?v=52';
import { TYPES as INJ } from '../engine/injuries.js?v=52';
import { beginOffseason, processDepartures, resolvePortal, resolveRecruiting, startNextSeason, openSpots, landOdds, SCHOLARSHIPS, scoutView, tagsOf, retainAsk, retain, pushRecruit, PUSHES } from '../engine/offseason.js?v=52';
import { mood, moodCtx, letter, talk, talksFor } from '../engine/morale.js?v=52';
import { ROT } from '../engine/health.js?v=52';
import { saveSlot, loadSlot, listSlots, removeSlot } from './store.js?v=52';
import { signedIn, cloudList, cloudPut, cloudGet, cloudDel } from './cloud.js?v=52';
import { lines as pbpLines } from './pbp.js?v=52';
import { gameSteps, newCtl } from '../engine/game.js?v=52';
import { calendarView, isCrawling, stopCrawl } from './calendar.js?v=52';
import { tireAt } from '../engine/program.js?v=52';
import { negotiate, priorities, profile, pursuit } from '../engine/recruit.js?v=52';
import { recruitingView } from './recruiting.js?v=52';
import { portalView } from './portal.js?v=52';
import { tournamentsView, awardsView } from './tourney.js?v=52';
import { scheduleStep } from './sched.js?v=52';
import { carouselStep, staffStep } from './carousel.js?v=52';
import { coachesView } from './coaches.js?v=52';
import { legacyView } from './legacy.js?v=52';
import { margins } from '../engine/history.js?v=52';
import { facilitiesRankHtml, bindFacilitiesRank } from './facilities.js?v=52';
import { durability, durTag, acadGrade, admitP, admitLabel, initSchools } from '../engine/people.js?v=52';
import { initFacilities } from '../engine/facilities.js?v=52';
import { inviteInfo, decide as realignDecide } from '../engine/realign.js?v=52';
import { programView, diffPicker } from './program.js?v=52';

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const short = n => (window.tdcShortSchool ? tdcShortSchool(n) : n);
const logo = n => { try { const c = window.tdcTeamColor && tdcTeamColor(n); return (c && c.logo) || ''; } catch (e) { return ''; } };
const color = n => { try { const c = window.tdcTeamColor && tdcTeamColor(n); return (c && c.c1) || '#888'; } catch (e) { return '#888'; } };
const tm = (n, cls = '') => `<span class="tm ${cls}">${logo(n) ? `<img src="${esc(logo(n))}" alt="" loading="lazy">` : ''}${esc(short(n))}</span>`;
const fmtDate = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const phi = x => 0.5 * (1 + erf(x / Math.SQRT2));
function erf(x) { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; }
const pl = (p, bold = true) => `<a class="pl" data-pid="${esc(p.id)}">${bold ? '<b>' : ''}${esc(p.name)}${bold ? '</b>' : ''}</a>`;
const PILLARS = [['SCO', 'Scoring'], ['SHT', 'Shooting'], ['FIN', 'Finishing'], ['PLY', 'Playmaking'], ['SEC', 'Ball security'], ['REB', 'Rebounding'], ['DEF', 'Defense']];

let S = null, slot = null, cache = {}, SNAP = null, SCHED = null, EXTRAS = null, RIVALS = null, tab = 'home', busy = false;
// annual non-conference series (scripts/build_dynasty_rivals.py) — new leagues and older saves both get them
const getFac = async () => FAC || (FAC = await fetch('data/dynasty-facilities.json?v=1').then(r => r.ok ? r.json() : {}).catch(() => ({})));   // real arenas + crowds
let FAC = null, GEO = null;
const getGeo = async () => GEO || (GEO = await fetch('data/dynasty-geo.json?v=1').then(r => r.ok ? r.json() : {}).catch(() => ({})));   // city, airport, international access
const getRivals = async () => RIVALS || (RIVALS = await fetch('data/dynasty-rivals.json?v=1').then(r => r.ok ? r.json() : { pairs: [] }).then(d => d.pairs || []).catch(() => []));
let newDiff = (() => { try { return localStorage.getItem('dy_diff') || 'pro'; } catch (e) { return 'pro'; } })();
const ovrOf = p => Math.round(effOvr(p, S));   // competition-adjusted: a low-major 84 shows ~75

// ── data + saves ──
async function loadData() {
  if (SNAP) return;
  $('#dyBody').innerHTML = '<div class="dy-empty">Loading the league…</div>';
  [SNAP, SCHED, EXTRAS] = await Promise.all([
    fetch('data/dynasty-snapshot.json?v=4').then(r => r.json()),
    fetch('scripts/data/schedule_2027.json?v=5').then(r => r.json()),
    fetch('scripts/data/schedule_extras_2027.json?v=2').then(r => r.ok ? r.json() : null).catch(() => null),   // games ESPN hadn't listed + MTE days
  ]);
}
function meta() {
  const r = record_(S, S.user), t = S.teams[S.user];
  return { team: S.user, year: S.year, w: r.w, l: r.l, phase: S.phase, coach: (t && t.coach && t.coach.name) || '' };
}
let saveT = null;
function autosave() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { saveSlot(slot, dehydrate(S), meta()).then(() => queueCloud()).catch(e => console.warn('save failed', e)); }, 300);
}

// ── account saves (cloud.js): every dynasty also syncs to the signed-in account, so it follows you across
// devices and survives a cleared browser. The device copy stays instant/offline; the account copy uploads
// ~20 s after you stop (and right away when you leave the page). Newest copy wins when you continue.
const CLOUD_WAIT = 20000;
let cloudT = null, cloudState = 'idle', cloudMsg = '';
function cloudBadge() {
  if (!signedIn()) return '<a class="dy-cloud off" href="signin.html?next=dynasty.html" title="Sign in to keep your dynasties on your account and play them on any device">☁ Sign in to save to your account</a>';
  const txt = { idle: '☁ On your account', pending: '☁ Saving soon…', saving: '☁ Saving…', saved: '☁ Saved to your account', error: '☁ Not saved to your account' }[cloudState];
  return `<span class="dy-cloud ${cloudState}" title="${esc(cloudState === 'error' ? cloudMsg + ' — your dynasty is still saved on this device' : 'Saved on this device and to your account')}">${txt}</span>`;
}
function setCloud(st, msg) { cloudState = st; cloudMsg = msg || ''; const el = $('#dyCloud'); if (el) el.innerHTML = cloudBadge(); }
function queueCloud(wait) {
  if (!signedIn() || !S || !slot) return;
  clearTimeout(cloudT); setCloud('pending'); cloudT = setTimeout(flushCloud, wait == null ? CLOUD_WAIT : wait);
}
async function flushCloud() {
  clearTimeout(cloudT); cloudT = null;
  if (!signedIn() || !S || !slot) return;
  setCloud('saving');
  try { await cloudPut(slot, dehydrate(S), meta(), Date.now()); setCloud('saved'); }
  catch (e) { setCloud('error', e.message); console.warn(e); }
}
// leaving the page (tab hidden / closed) uploads a pending save right away
document.addEventListener('visibilitychange', () => { if (document.hidden && cloudT) flushCloud(); });
window.addEventListener('pagehide', () => { if (cloudT) flushCloud(); });

// ── start screen ──
async function startScreen() {
  $('#dyHead').innerHTML = '<div class="eyebrow">Dynasty · beta</div><h1>Dynasty</h1>';
  // device + account saves, merged by slot (newest copy wins); a device-only or newer-on-device dynasty is
  // uploaded to the account in the background so existing dynasties move to the account on their own
  let cloudErr = '';
  const [loc, cl] = await Promise.all([listSlots().catch(() => []), signedIn() ? cloudList().catch(e => { cloudErr = e.message; return []; }) : []]);
  const by = {};
  for (const x of loc) by[x.slot] = { slot: x.slot, meta: x.meta, at: x.at, dev: x.at, acct: 0 };
  for (const x of cl) { const o = by[x.slot] || (by[x.slot] = { slot: x.slot, meta: x.meta, at: 0, dev: 0, acct: 0 }); o.acct = x.at; if (x.at > o.at) { o.at = x.at; o.meta = x.meta; } }
  const saves = Object.values(by).sort((a, b) => b.at - a.at);
  if (signedIn() && !cloudErr) saves.filter(x => x.dev && x.dev > x.acct + 1000).forEach(x => {
    loadSlot(x.slot).then(rec => rec && cloudPut(x.slot, rec.json, rec.meta, rec.at)).then(() => { const c = document.querySelector(`[data-where="${CSS.escape(x.slot)}"]`); if (c) c.innerHTML = where({ dev: 1, acct: 1 }); }).catch(e => console.warn(e));
  });
  const where = x => x.dev && x.acct ? '<span class="dy-where both" title="On this device and your account">Device + account</span>'
    : x.acct ? '<span class="dy-where acct" title="On your account — it downloads when you continue">Account</span>'
    : `<span class="dy-where dev" title="Only in this browser${signedIn() ? ' — uploading to your account' : ' — sign in to keep it on your account'}">This device</span>`;
  await loadData();
  const body = $('#dyBody');
  body.innerHTML = `
    ${saves.length ? `<div class="sec"><h2>Continue</h2></div>
      <div class="sheet-wrap"><table class="sheet dense dy-saves"><thead><tr><th class="l">Program</th><th>Season</th><th>Record</th><th class="l">Stage</th><th class="l">Saved</th><th class="l">Where</th><th></th></tr></thead><tbody>
      ${saves.map(s => `<tr><td class="l">${tm(s.meta.team)}</td><td>${s.meta.year - 1}-${String(s.meta.year).slice(2)}</td><td>${s.meta.w}-${s.meta.l}</td>
        <td class="l">${esc(phaseLabel(s.meta.phase))}</td><td class="l dim">${new Date(s.at).toLocaleString()}</td><td class="l" data-where="${esc(s.slot)}">${where(s)}</td>
        <td><button class="btn" data-load="${esc(s.slot)}">Continue</button> <button class="btn ghost" data-del="${esc(s.slot)}" title="Delete this save">✕</button></td></tr>`).join('')}
      </tbody></table></div>` : ''}
    <div class="dy-acct">${signedIn() ? (cloudErr ? `☁ Account saves are unavailable right now (${esc(cloudErr)}). Your dynasties are still saved on this device.` : '☁ Your dynasties save to your account, so you can continue them on any device.')
      : '☁ <a href="signin.html?next=dynasty.html">Sign in</a> to keep your dynasties on your account and continue them on any device. Without an account they live only in this browser.'}</div>
    <div class="sec"><h2>New dynasty</h2><span class="n">Pick a difficulty and a program. You start with its real 2026-27 roster, schedule, staff and NIL situation.</span></div>
    ${diffPicker(newDiff, esc)}
    <div class="dy-row"><input id="dyCoach" class="dy-input" placeholder="Your name (head coach)" maxlength="40" autocomplete="off"><input id="dySearch" class="dy-input" placeholder="Search programs…" autocomplete="off"></div>
    <div id="dyPick" class="dy-pick"></div>`;
  body.querySelectorAll('[data-load]').forEach(b => b.onclick = () => openSave(b.dataset.load));
  body.querySelectorAll('[data-diff]').forEach(b => b.onclick = () => { newDiff = b.dataset.diff; try { localStorage.setItem('dy_diff', newDiff); } catch (e) {} body.querySelectorAll('[data-diff]').forEach(x => x.classList.toggle('on', x === b)); });
  body.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const x = by[b.dataset.del];
    if (!confirm('Delete this dynasty' + (x && x.acct ? ' from this device AND your account' : '') + '? This cannot be undone.')) return;
    await removeSlot(b.dataset.del).catch(() => {});
    if (x && x.acct) await cloudDel(b.dataset.del).catch(e => alert('Could not delete it from your account: ' + e.message));
    startScreen();
  });
  const teams = SNAP.teams.slice().sort((a, b) => (b.rating ?? -99) - (a.rating ?? -99));
  const draw = q => {
    q = (q || '').toLowerCase();
    const list = teams.filter(t => !q || t.name.toLowerCase().includes(q) || (t.conf || '').toLowerCase().includes(q)).slice(0, q ? 60 : 40);
    $('#dyPick').innerHTML = list.map((t, i) => `<button class="dy-team" data-team="${esc(t.name)}" style="--tc:${esc(color(t.name))}">
      ${logo(t.name) ? `<img src="${esc(logo(t.name))}" alt="">` : ''}<span class="nm">${esc(short(t.name))}</span><span class="cf">${esc(t.conf || '')}</span>
      <span class="rk">${t.rating != null ? '#' + (teams.indexOf(t) + 1) : ''}</span></button>`).join('') || '<div class="dy-empty">No programs match.</div>';
    $('#dyPick').querySelectorAll('[data-team]').forEach(b => b.onclick = () => newDynasty(b.dataset.team));
  };
  draw(''); $('#dySearch').oninput = e => draw(e.target.value);
}

async function newDynasty(team) {
  await loadData();
  const cn = ($('#dyCoach') && $('#dyCoach').value.trim()) || 'You';
  S = hydrate(createLeague(SNAP, SCHED, { user: team, now: Date.now(), coachName: cn, extras: EXTRAS, diff: newDiff, rivals: await getRivals(), facilities: await getFac(), geo: await getGeo() }));
  slot = 'dyn-' + Date.now();
  cache = {}; touch(S); tab = 'calendar'; CAL._fresh = true;
  await saveSlot(slot, dehydrate(S), meta());
  render();
  queueCloud(0);
}
async function openSave(s) {
  // newest copy wins: download the account's copy when it is newer than this device's (or the device has none)
  let rec = await loadSlot(s).catch(() => null);
  if (signedIn()) {
    try {
      const L = await cloudList(), c = L.find(x => x.slot === s);
      if (c && (!rec || c.at > rec.at + 1000)) {
        $('#dyBody').innerHTML = '<div class="dy-empty">Downloading your dynasty from your account…</div>';
        const got = await cloudGet(s);
        if (got) { rec = got; await saveSlot(s, got.json, got.meta, got.at).catch(() => {}); }
      }
    } catch (e) { if (!rec) { alert('Could not load this dynasty from your account: ' + e.message); return startScreen(); } }
  }
  if (!rec) return startScreen();
  S = hydrate(JSON.parse(rec.json)); slot = s; cache = {}; touch(S); tab = 'calendar'; CAL._fresh = true;
  if (!S.rivals) S.rivals = (await getRivals()).filter(r => S.teams[r[0]] && S.teams[r[1]]);   // saves from before rivalries
  if (Object.values(S.teams).some(t => !t.fac)) initFacilities(S, await getFac());               // saves from before facilities
  if (Object.values(S.teams).some(t => t.acad == null)) initSchools(S, await getGeo());           // saves from before academics / international access
  setCloud(signedIn() ? 'idle' : 'idle');
  render();
}

// ── chrome ──
function phaseLabel(p) {
  return { regular: 'Regular season', conftourney: 'Conference tournaments', ncaa: 'NCAA tournament', done: 'Season complete', offseason: 'Offseason' }[p] || p;
}
const TABS = [['calendar', 'Calendar'], ['program', 'Program'], ['recruit', 'Recruiting'], ['home', 'Home'], ['schedule', 'Schedule'], ['roster', 'Roster'], ['plan', 'Game plan'], ['standings', 'Standings'], ['coach', 'Coach'], ['coaches', 'Coaches'], ['rankings', 'Rankings'], ['leaders', 'Leaders'], ['post', 'Tournaments'], ['awards', 'Awards'], ['news', 'News'], ['history', 'History']];
function render() {
  if (!S) return startScreen();
  const t = S.teams[S.user], r = record_(S, S.user), pw = power(S);
  const rank = Object.keys(pw).sort((a, b) => pw[b] - pw[a]).indexOf(S.user) + 1;
  const st = standings(S)[t.conf] || [], cpos = st.findIndex(x => x.team === S.user) + 1;
  $('#dyHead').innerHTML = `<div class="dy-band" style="--tc:${esc(color(S.user))}">
      ${logo(S.user) ? `<img src="${esc(logo(S.user))}" alt="">` : ''}
      <div class="dy-id"><div class="eyebrow">Dynasty · ${S.year - 1}-${String(S.year).slice(2)} · ${esc(phaseLabel(S.phase))}</div>
      <h1>${esc(short(S.user))}</h1>
      <div class="dy-meta">Coach ${esc((t.coach && t.coach.name) || 'You')} · <span class="sec-m" title="Job security: rises and falls with results vs expectations">Job security <i style="--v:${S.job ? S.job.security : 60}%"></i> ${S.job ? S.job.security : 60}</span></div>
      <div class="dy-meta"><b>${r.w}-${r.l}</b> · ${r.cw}-${r.cl} ${esc(t.conf)} (${cpos}${['th', 'st', 'nd', 'rd'][cpos % 10 > 3 || [11, 12, 13].includes(cpos % 100) ? 0 : cpos % 10]}) · Power #${rank}</div></div>
      <div class="dy-acts"><span id="dyCloud">${cloudBadge()}</span><button class="btn ghost" id="dyExit">Saves</button></div></div>
    <nav class="dy-tabs">${(S.phase === 'offseason' ? [['off', 'Offseason']] : []).concat(TABS).map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</nav>`;
  $('#dyExit').onclick = () => { if (isCrawling()) stopCrawl(); if (cloudT) flushCloud(); S = null; startScreen(); };
  $('#dyHead').querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { if (isCrawling()) stopCrawl(); tab = b.dataset.tab; render(); });
  if (S.phase === 'offseason' && tab === 'home') tab = 'off';
  ({ calendar: () => calendarView(CAL), program: () => programView(CAL), recruit: () => recruitingView(CAL), home, schedule, roster, plan, standings: standingsView, coaches: () => coachesView(CAL), coach: () => legacyView(CAL), rankings, leaders, post: () => tournamentsView(CAL), history, off: offseason, awards: () => awardsView(CAL), news: newsView })[tab]();
  document.querySelectorAll('#dyBody table.heat').forEach(x => window.tdcSheetHeat && tdcSheetHeat(x));
}

// the calendar's view of the app (S and cache are reassigned on new / open, so read them live)
const CAL = {
  get: () => S, get cache() { return cache; }, C, esc, short, logo, color, $,
  tm, pl, ovrOf: p => ovrOf(p), run: f => run(f), head: '', resetCache: () => { cache = {}; }, startSeason: () => run(() => { startNextSeason(S); tab = 'roster'; }),
  autosave: () => autosave(), render: () => render(), touch: () => touch(S), onWatch: () => watch(), onSimGame: () => run(simUserGame),
  openBox: id => { const g = S.schedule.find(x => x.id === id); if (g && S.userBox[id]) showBox(g, S.userBox[id]); },
};
// ── sim controls ──
const userNext = () => S.schedule.find(g => !g.r && (g.h === S.user || g.a === S.user));
async function run(fn) {
  if (busy) return; busy = true;
  document.body.classList.add('dy-busy');
  await new Promise(r => setTimeout(r, 20));
  try { fn(); } finally { busy = false; document.body.classList.remove('dy-busy'); autosave(); render(); }
}
const simToUserGame = () => simTo(S, C, cache, st => { const g = userNext(); return !g || g.d === nextDate(st); });
function simUserGame() {
  simToUserGame();
  const g = userNext(); if (!g) return;
  playGame(S, g, prepared(S, C, cache), C);
  simNext(S, C, cache);   // the rest of that day
}
function seasonDone() { return S.phase === 'done'; }

function home() {
  const g = userNext(), pw = power(S);
  let card = '';
  if (g) {
    const opp = g.h === S.user ? g.a : g.h, home = g.h === S.user;
    const sp = lineFor(S, g, pw) * (home ? 1 : -1), wp = phi(sp / 11);
    card = `<div class="dy-next"><div class="lbl">Next game · ${fmtDate(g.d)}${g.t === 'ct' ? ' · Conference tournament' : g.t === 'ncaa' ? ' · NCAA tournament' : g.c ? ' · Conference' : ''}</div>
      <div class="mu">${g.n ? 'vs' : home ? 'vs' : '@'} ${tm(opp, 'big')} <span class="dim">${g.n ? '(neutral)' : ''}</span></div>
      <div class="ln">${sp >= 0 ? `${esc(short(S.user))} −${Math.abs(sp).toFixed(1)}` : `${esc(short(opp))} −${Math.abs(sp).toFixed(1)}`} · win ${Math.max(1, Math.min(99, Math.round(100 * wp)))}%</div>
      <div class="dy-btns"><button class="btn" id="bWatch">▶ Watch</button><button class="btn" id="bSim">Sim game</button>
      <button class="btn ghost" id="bWeek">Sim 7 days</button>${S.phase === 'regular' ? '<button class="btn ghost" id="bReg">Sim to end of regular season</button>' : ''}
      <button class="btn ghost" id="bAll">Sim to end of season</button></div></div>`;
  } else if (!seasonDone()) {
    card = `<div class="dy-next"><div class="lbl">${esc(phaseLabel(S.phase))}</div>
      <div class="mu">${S.phase === 'ncaa' || S.phase === 'conftourney' ? 'Your season is over — the tournament goes on.' : 'No games scheduled.'}</div>
      <div class="dy-btns"><button class="btn" id="bDay">Sim next day</button><button class="btn ghost" id="bAll">Sim to end of season</button></div></div>`;
  } else {
    const champ = S.post.ncaa.champ;
    card = `<div class="dy-next"><div class="lbl">Season complete</div><div class="mu">🏆 ${tm(champ, 'big')} national champions</div>
      <div class="ln">${esc(short(S.user))}: ${esc(postResult(S, S.user) || 'no postseason')}${S.post.nit && S.post.nit.champ ? ` · NIT: ${esc(short(S.post.nit.champ))}` : ''}${S.post.cbi && S.post.cbi.champ ? ` · CBI: ${esc(short(S.post.cbi.champ))}` : ''}</div>
      <div class="dy-btns"><button class="btn" id="bOff">Begin the offseason →</button></div></div>`;
  }
  const recent = S.schedule.filter(x => x.r && (x.h === S.user || x.a === S.user)).slice(-6).reverse();
  const top = poll(S, 10);
  const hurt = S.teams[S.user].players.map(id => S.players[id]).filter(p => p && p.out > 0);
  const inj = hurt.length ? `<div class="dy-inj"><b>Injury report</b> ${hurt.map(p => `${pl(p, false)} — ${esc(p.inj ? p.inj.type : 'injured')}, ${p.out >= 99 ? 'out for the season' : `out ${p.out} game${p.out > 1 ? 's' : ''}`}`).join(' · ')}</div>` : '';
  const nws = (S.news || []).slice(-8).reverse();
  $('#dyBody').innerHTML = card + inj + `<div class="dy-two"><div><div class="sec"><h2>Recent results</h2></div>${gamesTable(recent, true)}
    <div class="sec"><h2>News</h2><a class="n" data-goto="news" href="#">All news →</a></div>${newsList(nws)}</div>
    <div><div class="sec"><h2>Top 10</h2></div><div class="sheet-wrap"><table class="sheet dense"><thead><tr><th>#</th><th class="l">Team</th><th>Rec</th><th>Power</th></tr></thead><tbody>
    ${top.map(r => `<tr class="${r.team === S.user ? 'me' : ''}"><td>${r.rank}</td><td class="l">${tm(r.team)}</td><td>${r.w}-${r.l}</td><td>${r.power.toFixed(1)}</td></tr>`).join('')}</tbody></table></div></div></div>`;
  const on = (id, f) => { const b = document.getElementById(id); if (b) b.onclick = f; };
  on('bWatch', watch);
  on('bSim', () => run(simUserGame));
  on('bWeek', () => run(() => { const d0 = nextDate(S); const end = new Date(Date.parse(d0 + 'T12:00:00Z') + 7 * 864e5).toISOString().slice(0, 10); simTo(S, C, cache, st => !nextDate(st) || nextDate(st) >= end); }));
  on('bReg', () => run(() => simTo(S, C, cache, st => st.phase !== 'regular')));
  on('bAll', () => run(() => simTo(S, C, cache, seasonDone)));
  on('bDay', () => run(() => simNext(S, C, cache)));
  on('bOff', () => { beginOffseason(S); tab = 'off'; autosave(); render(); });
}

function gamesTable(games, mine) {
  if (!games.length) return '<div class="dy-empty">No games yet.</div>';
  return `<div class="sheet-wrap"><table class="sheet dense dy-g"><thead><tr><th class="l">Date</th><th class="l">Opponent</th><th>Result</th><th class="l"></th></tr></thead><tbody>
  ${games.map(g => {
    const home = g.h === S.user, opp = home ? g.a : g.h;
    let res = '';
    if (g.r) { const us = home ? g.r[0] : g.r[1], them = home ? g.r[1] : g.r[0]; res = `<b class="${us > them ? 'w' : 'l'}">${us > them ? 'W' : 'L'}</b> ${us}-${them}${g.r[2] ? ` (${g.r[2] > 1 ? g.r[2] : ''}OT)` : ''}`; }
    const tag = g.t === 'ct' ? 'Conf. tourney' : g.t === 'ncaa' ? 'NCAA' : g.c ? 'Conf' : '';
    return `<tr class="${g.r && S.userBox[g.id] ? 'go' : ''}" data-box="${esc(g.id)}"><td class="l">${fmtDate(g.d)}</td><td class="l">${g.n ? 'vs' : home ? 'vs' : '@'} ${tm(opp)}</td><td>${res}</td><td class="l dim">${tag}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
document.addEventListener('click', e => {
  const tr = e.target.closest('tr[data-box]'); if (!tr || !S || !S.userBox[tr.dataset.box]) return;
  const g = S.schedule.find(x => x.id === tr.dataset.box); showBox(g, S.userBox[g.id]);
});

// ── watch a game ──
function watch() {
  if (busy) return;
  simToUserGame();
  const g = userNext(); if (!g) return render();
  const prep = prepared(S, C, cache);
  // LIVE: the game is played a possession at a time, so the coach's timeouts change what happens next
  const me = g.h === S.user ? 0 : 1, opp = me ? g.h : g.a;
  let autoTO = false; try { autoTO = localStorage.getItem('dy_autoto') === '1'; } catch (e) {}
  const ctl = newCtl(me === 0 ? [autoTO, true] : [true, autoTO]);
  const it = gameSteps(prep.teams[g.h], prep.teams[g.a], { C, L: prep.L, seed: gameSeed(S, g), neutral: g.n, log: true, ctl });
  const names = {}; for (const t of [prep.teams[g.h], prep.teams[g.a]]) for (const p of t.roster) names[p.id] = p.name;
  const ov = document.createElement('div'); ov.className = 'dy-ov';
  ov.innerHTML = `<div class="dy-watch"><div class="dy-sb"><div>${tm(g.a)}<b id="sA">0</b></div><div class="clk"><span id="sP">1st</span><b id="sC">20:00</b></div><div><b id="sH">0</b>${tm(g.h)}</div></div>
    <div class="dy-tobar"><button class="btn" id="wTO">⏱ Timeout (<span id="toN">${ctl.to[me]}</span> left)</button><span id="wRun" class="dy-run"></span>
      <label class="cal-chk"><input type="checkbox" id="wAuto" ${autoTO ? 'checked' : ''}> Let my staff call them</label></div>
    <div class="dy-speed">Speed <button data-sp="700">Live</button><button data-sp="140" class="on">Fast</button><button data-sp="25">Faster</button><button data-sp="0">Skip to end</button></div>
    <div class="dy-feed" id="feed"></div><div class="dy-btns"><button class="btn" id="wDone" disabled>Final — continue</button></div></div>`;
  document.body.appendChild(ov);
  let sp = 140, timer = null, shown = 0, result = null;
  const feed = ov.querySelector('#feed'), teams = [g.h, g.a];
  const draw = ev => {
    const L = pbpLines(ev, id => names[id] || '?', teams, short);
    for (; shown < L.length; shown++) {
      const l = L[shown];
      ov.querySelector('#sH').textContent = l.score[0]; ov.querySelector('#sA').textContent = l.score[1];
      ov.querySelector('#sP').textContent = l.period; ov.querySelector('#sC').textContent = l.clock;
      if (l.sub && sp < 140) continue;
      const row = document.createElement('div'); row.className = 'pl' + (l.pts ? ' sc' : '') + (l.sub ? ' sub' : '') + (/^TIMEOUT/.test(l.txt) ? ' tmo' : '');
      row.innerHTML = `<span class="t">${l.period} ${l.clock}</span><img src="${esc(logo(l.team))}" alt=""><span>${esc(l.txt)}</span><span class="s">${l.score[1]}-${l.score[0]}</span>`;
      feed.prepend(row);
    }
  };
  const status = v => {
    const toB = ov.querySelector('#wTO'); ov.querySelector('#toN').textContent = ctl.to[me];
    toB.disabled = !!result || ctl.to[me] <= 0 || ctl.call[me];
    const r = v && v.run, el = ov.querySelector('#wRun');
    el.textContent = r && r[1 - me] >= 8 ? `${short(opp)} on a ${r[1 - me]}-point run` : r && r[me] >= 8 ? `${short(S.user)} on a ${r[me]}-point run` : '';
    el.className = 'dy-run' + (r && r[1 - me] >= 8 ? ' bad' : r && r[me] >= 8 ? ' good' : '');
  };
  const step = () => {
    if (result) return;
    const r = it.next();
    if (r.done) { result = r.value; record(S, g, result); autosave(); draw(result.events); clearInterval(timer); finish(); return; }
    draw(r.value.events); status(r.value);
  };
  const go = () => { clearInterval(timer); if (sp === 0) { while (!result) step(); } else timer = setInterval(step, sp); };
  ov.querySelectorAll('[data-sp]').forEach(b => b.onclick = () => { ov.querySelectorAll('[data-sp]').forEach(x => x.classList.remove('on')); b.classList.add('on'); sp = +b.dataset.sp; go(); });
  ov.querySelector('#wTO').onclick = () => { if (ctl.to[me] > 0) { ctl.call[me] = true; status(null); } };
  ov.querySelector('#wAuto').onchange = e => { ctl.auto[me] = e.target.checked; try { localStorage.setItem('dy_autoto', e.target.checked ? '1' : '0'); } catch (x) {} };
  const finish = () => {
    status(null);
    const done = ov.querySelector('#wDone'); done.disabled = false;
    ov.querySelector('#sP').textContent = 'Final' + (result.ot ? (result.ot > 1 ? ` (${result.ot}OT)` : ' (OT)') : ''); ov.querySelector('#sC').textContent = '';
    feed.insertAdjacentHTML('afterbegin', boxHtml(g, { box: result.box, score: result.score, ot: result.ot }));
    done.onclick = () => { ov.remove(); run(() => simNext(S, C, cache)); };
  };
  go();
}

function boxHtml(g, rec) {
  const side = (rows, team) => `<div class="sec"><h2>${tm(team)}</h2></div><div class="sheet-wrap"><table class="sheet dense dy-box"><thead><tr><th class="l">Player</th><th>MIN</th><th>PTS</th><th>FG</th><th>3PT</th><th>FT</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TO</th><th>PF</th></tr></thead><tbody>
    ${rows.slice().sort((a, b) => b.min - a.min).map(r => `<tr><td class="l">${esc(r.name)}</td><td>${Math.round(r.min)}</td><td><b>${r.pts}</b></td><td>${r.fgm}-${r.fga}</td><td>${r.tpm}-${r.tpa}</td><td>${r.ftm}-${r.fta}</td><td>${r.orb + r.drb}</td><td>${r.ast}</td><td>${r.stl}</td><td>${r.blk}</td><td>${r.tov}</td><td>${r.pf}</td></tr>`).join('')}</tbody></table></div>`;
  return `<div class="dy-box"><div class="dy-final">${tm(g.a)} <b>${rec.score[1]}</b> — <b>${rec.score[0]}</b> ${tm(g.h)}${rec.ot ? ` <span class="dim">${rec.ot > 1 ? rec.ot : ''}OT</span>` : ''}</div>${side(rec.box.away, g.a)}${side(rec.box.home, g.h)}</div>`;
}
function showBox(g, rec) {
  const ov = document.createElement('div'); ov.className = 'dy-ov';
  ov.innerHTML = `<div class="dy-watch">${boxHtml(g, rec)}<div class="dy-btns"><button class="btn" id="bxClose">Close</button></div></div>`;
  document.body.appendChild(ov);
  ov.querySelector('#bxClose').onclick = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
}

// ── tabs ──
// what kind of non-conference game it is (schedule.js), with the guarantee money
function gameKind(g, home) {
  if (g.k === 'rivalry') return 'Rivalry';
  if (g.k === 'return') return 'Return game';
  if (g.k === 'marquee') return 'Marquee';
  if (g.pay) return home ? `Buy game <span class="dn">−$${g.pay}k</span>` : `Guarantee <span class="up">+$${g.pay}k</span>`;
  return g.fill ? 'Added' : '';
}
function schedule() {
  const mine = S.schedule.filter(g => g.h === S.user || g.a === S.user);
  const pw = power(S);
  $('#dyBody').innerHTML = `<div class="sec"><h2>Schedule</h2><span class="n">${mine.length + (S.pending || []).filter(x => x.team === S.user && !x.done).length} games · click a played game for its box score</span></div>
  <div class="sheet-wrap"><table class="sheet dense dy-s"><thead><tr><th class="l">Date</th><th class="l">Opponent</th><th>Opp power</th><th>Line</th><th>Result</th><th class="l"></th></tr></thead><tbody>
  ${mine.map(g => {
    const home = g.h === S.user, opp = home ? g.a : g.h, sp = lineFor(S, g, pw) * (home ? 1 : -1);
    let res = '';
    if (g.r) { const us = home ? g.r[0] : g.r[1], them = home ? g.r[1] : g.r[0]; res = `<b class="${us > them ? 'w' : 'l'}">${us > them ? 'W' : 'L'}</b> ${us}-${them}${g.r[2] ? ' OT' : ''}`; }
    return `<tr class="${g.r && S.userBox[g.id] ? 'go' : ''}" data-box="${esc(g.id)}"><td class="l">${fmtDate(g.d)}</td><td class="l">${g.n ? 'vs' : home ? 'vs' : '@'} ${tm(opp)}</td>
      <td>${pw[opp] != null ? pw[opp].toFixed(1) : '—'}</td><td>${g.r ? '' : (sp >= 0 ? '−' : '+') + Math.abs(sp).toFixed(1)}</td><td>${res}</td><td class="l dim">${g.t === 'ct' ? 'Conf. tourney' : g.t === 'ncaa' ? 'NCAA' : g.t === 'nit' ? 'NIT' : g.t === 'cbi' ? 'CBI' : g.ev ? esc(g.ev.replace(/ · day.*/, '')) : !S.teams[opp] ? 'Non-D-I' : g.c ? 'Conf' : gameKind(g, home)}</td></tr>`;
  }).join('')}${(S.mtes || []).filter(m => m.teams.some(x => x.team === S.user)).flatMap(m => (S.pending || []).filter(x => x.type === 'mte' && x.id === m.id && !x.done).map(x => `<tr><td class="l">${fmtDate(x.d)}</td><td class="l dim">TBD — decided by the earlier rounds</td><td></td><td></td><td></td><td class="l dim">${esc(m.name)}</td></tr>`)).join('')}${(S.pending || []).filter(x => x.team === S.user && !x.done).map(x => `<tr><td class="l">${fmtDate(x.d)}</td><td class="l dim">TBD — decided by the earlier rounds</td><td></td><td></td><td></td><td class="l dim">${esc((x.ev || '').replace(/ · day.*/, ''))}</td></tr>`).join('')}</tbody></table></div>`;
}

function roster() {
  const t = S.teams[S.user];
  const prep = prepared(S, C, cache).teams[S.user];
  const auto = Object.fromEntries(prep.roster.map(p => [p.id, p.target]));
  const ps = t.players.map(id => S.players[id]).filter(Boolean).sort((a, b) => (auto[b.id] || 0) - (auto[a.id] || 0));
  const starters = new Set(t.starters || prep.roster.slice(0, 5).map(p => p.id));
  const stat = (id, k) => { const s = S.stats[id]; return s && s.g ? (s[k] / s.g).toFixed(1) : '—'; };
  const MC = moodCtx(S);
  $('#dyBody').innerHTML = `<div class="sec"><h2>Roster</h2><span class="n">Set starters (exactly five) and minutes per game — the sim plays your rotation. Minutes are scaled to 200 per game.</span></div>
  <div class="sheet-wrap"><table class="sheet dense heat dy-roster"><thead><tr><th class="l">Player</th><th>Pos</th><th>Yr</th><th>Ht</th><th data-heat="1" title="Overall, adjusted for the level of competition the player's ratings came from">OVR</th>
    ${PILLARS.map(([k, l]) => `<th data-heat="1" title="${l}">${k}</th>`).join('')}<th data-heat="1" title="Stamina: he starts to wear down past about 28 + STA/9 minutes a night (guards usually carry more than bigs). Conditioning is a practice focus.">STA</th><th data-heat="1" title="Durability: how well his body holds up. Low = injury prone (a serious injury lowers it).">DUR</th><th title="Academics (A+ to F). Below a D- he's ineligible; weak students can lose the spring semester.">ACAD</th><th title="Season health: minutes wear him down, days off recover him. Worn-down players play tired and get hurt more; a hard season costs career health.">HP</th><th class="l" title="His dealbreaker — the one thing he has to have — graded vs what he expects (better players expect more). A broken dealbreaker pushes him toward the portal.">Mood</th><th>Start</th><th>Min</th><th>MPG</th><th>PPG</th><th>RPG</th><th>APG</th></tr></thead><tbody>
  ${ps.map(p => `<tr class="${p.out > 0 ? 'hurt' : ''}"><td class="l">${pl(p)}<div class="dy-tags">${tagsOf(p.pillars, p.ht, p.sta).map(x => `<span>${esc(x)}</span>`).join('')}</div>${p.out > 0 ? ` <span class="chip" title="${esc(p.inj ? p.inj.type : '')}">OUT ${p.out >= 99 ? 'season' : p.out + 'g'}</span>` : ''}${(() => { const d = S.lastOff && S.lastOff.progress && S.lastOff.progress[p.id]; return d ? ` <span class="${d > 0 ? 'up' : 'dn'}">${d > 0 ? '+' : ''}${d}</span>` : ''; })()}</td><td>${esc(p.pos || '')}</td><td>${YR_LABEL[p.yr] || ''}</td><td>${p.ht ? `${Math.floor(p.ht / 12)}-${p.ht % 12}` : ''}</td><td><b>${ovrOf(p)}</b></td>
    ${PILLARS.map(([k]) => `<td>${p.pillars[k]}</td>`).join('')}<td title="Wears down past ~${Math.round(tireAt(p))} min">${p.sta ?? '—'}</td><td title="${esc(durTag(p))}">${durability(p)}</td><td>${acadGrade(p.acad ?? 60)}</td><td title="Career health ${Math.round(p.chp ?? 100)}" class="${(p.hp ?? 100) < 60 ? 'dn' : ''}">${Math.round(p.hp ?? 100)}</td><td class="l">${(m => m ? `<span class="${m.mood === 'Wants out' ? 'dn' : m.mood === 'Restless' ? 'warn' : m.mood === 'Happy' ? 'up' : ''}" title="${esc(m.label)}: ${letter(m.grade)} (expects ${letter(m.exp)})">${esc(m.label)} ${letter(m.grade)} · ${m.mood}</span>` : '')(mood(S, p, MC))}</td>
    <td><input type="checkbox" data-st="${esc(p.id)}" ${starters.has(p.id) ? 'checked' : ''}></td>
    <td><input type="number" class="dy-min" min="0" max="40" step="1" data-min="${esc(p.id)}" data-tire="${tireAt(p).toFixed(1)}" value="${Math.round(t.minutes && t.minutes[p.id] != null ? t.minutes[p.id] : (auto[p.id] || 0))}"></td>
    <td>${stat(p.id, 'min')}</td><td>${stat(p.id, 'pts')}</td><td>${(() => { const s = S.stats[p.id]; return s && s.g ? ((s.orb + s.drb) / s.g).toFixed(1) : '—'; })()}</td><td>${stat(p.id, 'ast')}</td></tr>`).join('')}
  </tbody></table></div>
  <div class="dy-btns"><span id="minSum" class="dim"></span><button class="btn" id="rSave">Save rotation</button><button class="btn ghost" id="rAuto">Reset to the coach's default</button>
    <label class="dim" title="How hard the default rotation rides your starters (wear and tear)">Rotation <select id="rRot" class="dy-input sm">${ROT.map(([k, l]) => `<option value="${k}" ${(t.rot || 'normal') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>`;
  // a player set past his stamina threshold is flagged (he loses shooting + ball security and gets hurt more)
  const sum = () => { let s = 0; document.querySelectorAll('[data-min]').forEach(i => { s += +i.value || 0; const over = (+i.value || 0) - (+i.dataset.tire || 99); i.classList.toggle('tired', over > 0); i.title = over > 0 ? `${over.toFixed(0)} min past what he can carry: he'll wear down` : ''; }); $('#minSum').textContent = `Total ${s} min (scaled to 200)`; };
  document.querySelectorAll('[data-min]').forEach(i => i.oninput = sum); sum();
  $('#rSave').onclick = () => {
    const st = [...document.querySelectorAll('[data-st]:checked')].map(i => i.dataset.st);
    if (st.length !== 5) return alert(`Pick exactly five starters (you have ${st.length}).`);
    const m = {}; document.querySelectorAll('[data-min]').forEach(i => { m[i.dataset.min] = Math.max(0, Math.min(40, +i.value || 0)); });
    if (st.some(id => !m[id])) return alert('Every starter needs minutes.');
    t.starters = st; t.minutes = m; touch(S); autosave(); render();
  };
  $('#rRot').onchange = e => { t.rot = e.target.value; touch(S); autosave(); render(); };
  $('#rAuto').onclick = () => { t.starters = null; t.minutes = null; touch(S); autosave(); render(); };
}

function plan() {
  const t = S.teams[S.user], p = t.plan || (t.plan = { tempo: 0, three: 0, pressure: 0 });
  const rows = [['tempo', 'Tempo', 'Slow it down', 'Push the pace', 'More possessions favour the better team and raise totals; slowing down shortens the game (an underdog\'s friend).'],
    ['three', 'Three-point emphasis', 'Attack inside', 'Bomb away', 'Shifts your shot mix. Forcing the mix away from your roster\'s natural game costs a little shot quality.'],
    ['pressure', 'Defensive pressure', 'Sit back', 'Full-court pressure', 'More pressure forces turnovers but sends opponents to the line more and gives up easier looks.']];
  $('#dyBody').innerHTML = `<div class="sec"><h2>Game plan</h2><span class="n">Applies to every game until you change it. 0 = your team's natural game.</span></div>
  ${rows.map(([k, l, lo, hi, d]) => `<div class="dy-slider"><div class="hd"><b>${l}</b><span id="v-${k}">${p[k] > 0 ? '+' : ''}${p[k]}</span></div>
    <div class="row"><span class="dim">${lo}</span><input type="range" min="-2" max="2" step="1" value="${p[k]}" data-plan="${k}"><span class="dim">${hi}</span></div><div class="d">${d}</div></div>`).join('')}`;
  document.querySelectorAll('[data-plan]').forEach(i => i.oninput = () => {
    p[i.dataset.plan] = +i.value; $('#v-' + i.dataset.plan).textContent = (+i.value > 0 ? '+' : '') + i.value; touch(S); autosave();
  });
}

function standingsView() {
  const st = standings(S), mine = S.teams[S.user].conf;
  const confs = Object.keys(st).sort();
  const sel = standingsView.conf || mine;
  $('#dyBody').innerHTML = `<div class="sec"><h2>Standings</h2><select id="cSel" class="dy-input sm">${confs.map(c => `<option ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
  <div class="sheet-wrap"><table class="sheet dense"><thead><tr><th>#</th><th class="l">Team</th><th>Conf</th><th>Overall</th><th title="Points scored minus allowed (regular season)">Diff</th><th title="Average margin a game">Margin</th><th>Power</th><th class="l" title="How a tie in the league record was broken">Tiebreak</th></tr></thead><tbody>
  ${(() => { const pw = power(S), M = margins(S); return st[sel].map((r, i) => { const m = M[r.team] || { pf: 0, pa: 0, g: 0 }, d = m.pf - m.pa; return `<tr class="${r.team === S.user ? 'me' : ''}"><td>${i + 1}</td><td class="l">${tm(r.team)}</td><td>${r.cw}-${r.cl}</td><td>${r.w}-${r.l}</td><td class="${d >= 0 ? 'up' : 'dn'}">${d > 0 ? '+' : ''}${d}</td><td>${m.g ? (d / m.g > 0 ? '+' : '') + (d / m.g).toFixed(1) : ''}</td><td>${pw[r.team].toFixed(1)}</td><td class="l dim">${r.tb || ''}</td></tr>`; }).join(''); })()}
  </tbody></table></div><div class="pg-d">Ties in the league standings: head-to-head among the tied teams first, then record against the teams above them, then power rating.</div>`;
  $('#cSel').onchange = e => { standingsView.conf = e.target.value; render(); };
}

function rankings() {
  const sub = `<div class="tn-tabs">${[['power', 'Power'], ['fac', 'Facilities']].map(([k, l]) => `<button class="${(rankings.v || 'power') === k ? 'on' : ''}" data-rkv="${k}">${l}</button>`).join('')}</div>`;
  const bindSub = () => document.querySelectorAll('[data-rkv]').forEach(b => b.onclick = () => { rankings.v = b.dataset.rkv; rankings(); });
  if (rankings.v === 'fac') { $('#dyBody').innerHTML = sub + facilitiesRankHtml(CAL); bindFacilitiesRank(CAL, rankings); bindSub(); if (window.tdcSheetHeat) document.querySelectorAll('#dyBody table.heat').forEach(x => tdcSheetHeat(x)); return; }
  const pw = power(S), all = Object.keys(pw).sort((a, b) => pw[b] - pw[a]);
  $('#dyBody').innerHTML = sub + `<div class="sec"><h2>Power rankings</h2><span class="n">Opponent-adjusted scoring margin, blended with the preseason roster rating early in the year</span></div>
  <div class="sheet-wrap"><table class="sheet dense heat dy-rk"><thead><tr><th>#</th><th class="l">Team</th><th class="l">Conf</th><th>Rec</th><th data-heat="1">Power</th></tr></thead><tbody>
  ${all.map((t, i) => { const r = record_(S, t); return `<tr class="${t === S.user ? 'me' : ''}"><td>${i + 1}</td><td class="l">${tm(t)}</td><td class="l dim">${esc(S.teams[t].conf)}</td><td>${r.w}-${r.l}</td><td>${pw[t].toFixed(1)}</td></tr>`; }).join('')}
  </tbody></table></div>`;
  bindSub();
}

function leaders() {
  const rows = Object.entries(S.stats).filter(([, s]) => s.g >= Math.max(3, Math.floor(maxG() * 0.6))).map(([id, s]) => ({ id, s, p: S.players[id] })).filter(x => x.p);
  const cats = [['pts', 'Points'], ['reb', 'Rebounds'], ['ast', 'Assists'], ['stl', 'Steals'], ['blk', 'Blocks']];
  const val = (x, k) => (k === 'reb' ? x.s.orb + x.s.drb : x.s[k]) / x.s.g;
  $('#dyBody').innerHTML = `<div class="sec"><h2>League leaders</h2><span class="n">Per game, players in 60%+ of games</span></div><div class="dy-grid">
  ${cats.map(([k, l]) => `<div class="sheet-wrap"><table class="sheet dense dy-ld"><thead><tr><th>#</th><th class="l">${l}</th><th class="l">Team</th><th>Per game</th></tr></thead><tbody>
    ${rows.slice().sort((a, b) => val(b, k) - val(a, k)).slice(0, 15).map((x, i) => `<tr class="${x.p.team === S.user ? 'me' : ''}"><td>${i + 1}</td><td class="l">${pl(x.p, false)}</td><td class="l">${tm(x.p.team)}</td><td><b>${val(x, k).toFixed(1)}</b></td></tr>`).join('')}
  </tbody></table></div>`).join('')}</div>`;
}
const maxG = () => Math.max(0, ...Object.values(S.stats).map(s => s.g));

// ── news, awards, player cards ──
const NICON = { fac: '🏗️', conf: '🏛️', draft: '🎟️',  injury: '🩹', return: '✅', award: '🏆', coach: '📋', title: '🏆' };
function newsList(items) {
  if (!items.length) return '<div class="dy-empty">No news yet.</div>';
  return `<div class="dy-news">${items.map(n => `<div class="${n.mine ? 'mine' : ''}"><span class="d">${fmtDate(n.d)}</span><span>${NICON[n.type] || '•'}</span><span>${esc(n.text).replace(/\[\[([^\]]+)\]\]/g, (m, t) => esc(short(t)))}</span></div>`).join('')}</div>`;
}
function newsView() {
  const all = (S.news || []).slice().reverse(), mine = newsView.mine;
  const items = mine ? all.filter(n => n.mine) : all;
  $('#dyBody').innerHTML = `<div class="sec"><h2>News</h2><span class="n"><label><input type="checkbox" id="nMine" ${mine ? 'checked' : ''}> Only ${esc(short(S.user))}</label></span></div>${newsList(items)}`;
  $('#nMine').onchange = e => { newsView.mine = e.target.checked; render(); };
}
document.addEventListener('click', e => {
  const a = e.target.closest('[data-goto]'); if (a) { e.preventDefault(); tab = a.dataset.goto; render(); return; }
  const p = e.target.closest('a.pl[data-pid]'); if (p && S) { e.preventDefault(); playerCard(p.dataset.pid); }
});

function playerCard(id) {
  const p = S.players[id]; if (!p) return;
  const s = S.stats[id], line = s && s.g ? `${s.g} G · ${(s.min / s.g).toFixed(1)} MPG · ${(s.pts / s.g).toFixed(1)} PPG · ${((s.orb + s.drb) / s.g).toFixed(1)} RPG · ${(s.ast / s.g).toFixed(1)} APG · ${s.fga ? (100 * s.fgm / s.fga).toFixed(1) : '—'} FG% · ${s.tpa ? (100 * s.tpm / s.tpa).toFixed(1) : '—'} 3P%` : 'No games this season';
  const awards = (p.hon || []).slice().reverse();   // every honor he has won (engine/awards.js honor())
  const ov = document.createElement('div'); ov.className = 'dy-ov';
  ov.innerHTML = `<div class="dy-watch dy-card"><div class="hd">${p.team ? `<img src="${esc(logo(p.team))}" alt="">` : ''}<div><div class="eyebrow">${esc(p.team ? short(p.team) : 'Transfer portal')} · ${esc(p.pos || '')} · ${YR_LABEL[p.yr] || ''}${p.ht ? ` · ${Math.floor(p.ht / 12)}-${p.ht % 12}` : ''}${p.stars ? ` · ${'★'.repeat(p.stars)} recruit` : ''}${p.country ? ` · ${esc(p.country)}` : ''}</div>
      <h2>${esc(p.name)}</h2><div class="dim">${line}</div><div class="dim">Durability ${durability(p)} (${esc(durTag(p))}) · Academics ${acadGrade(p.acad ?? 60)}</div>${p.out > 0 ? `<div class="hurt">🩹 ${esc(p.inj ? p.inj.type : 'Injured')} — ${p.out >= 99 ? 'out for the season' : `out ${p.out} game${p.out > 1 ? 's' : ''}`}</div>` : ''}</div><div class="ovr"><b>${ovrOf(p)}</b><span>OVR</span></div></div>
    <div class="bars">${PILLARS.map(([k, l]) => `<div><span>${l}</span><i style="--v:${p.pillars[k]}%"></i><b>${p.pillars[k]}</b></div>`).join('')}</div>
    ${awards.length ? `<div class="aw">🏆 ${awards.map(esc).join(' · ')}</div>` : ''}
    ${(p.hist || []).length ? `<div class="sec"><h2>Career</h2></div><div class="sheet-wrap"><table class="sheet dense"><thead><tr><th class="l">Season</th><th class="l">Team</th><th>G</th><th>MPG</th><th>PPG</th><th>RPG</th><th>APG</th><th>OVR</th></tr></thead><tbody>
      ${p.hist.map(h => `<tr><td class="l">${h.y - 1}-${String(h.y).slice(2)}</td><td class="l">${tm(h.team)}</td><td>${h.g}</td><td>${h.mpg}</td><td>${h.ppg}</td><td>${h.rpg}</td><td>${h.apg}</td><td>${h.ovr}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="dy-btns"><button class="btn" id="pcClose">Close</button></div></div>`;
  document.body.appendChild(ov);
  ov.querySelector('#pcClose').onclick = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
}

// ── offseason ──
const stars = n => '★'.repeat(n) + '<span class="dim">' + '★'.repeat(Math.max(0, 5 - n)) + '</span>';
const WHY = { graduated: 'Graduated', pro: 'Turned pro', portal: 'Entered the transfer portal' };
function offseason() {
  const O = S.off, U = S.user, step = O.step, open = openSpots(S, U);
  const steps = [['carousel', 'Carousel'], ['staff', 'Staff'], ['departures', 'Departures'], ['portal', 'Transfer portal'], ['recruiting', 'Recruiting'], ['ready', 'Signing day'], ['schedule', 'Schedule']];
  let html = `<div class="dy-steps">${steps.map(([k, l], i) => `<span class="${k === step ? 'on' : steps.findIndex(x => x[0] === step) > i ? 'done' : ''}">${i + 1}. ${l}</span>`).join('')}</div>`;
  if (step === 'departures') {
    const mine = Object.entries(O.leaving).map(([id, why]) => ({ p: S.players[id], why })).filter(x => x.p && x.p.team === U);
    const all = Object.values(O.leaving), c = w => all.filter(x => x === w).length;
    html += `${realignPanel()}
      <div class="sec"><h2>Leaving ${esc(short(U))}</h2><span class="n">League-wide: ${c('graduated')} graduated, ${c('pro')} turned pro, ${c('portal')} entered the portal</span></div>
      ${mine.length ? `<div class="sheet-wrap"><table class="sheet dense"><thead><tr><th class="l">Player</th><th>Pos</th><th>Yr</th><th>OVR</th><th class="l">Why</th></tr></thead><tbody>
        ${mine.sort((a, b) => ovrOf(b.p) - ovrOf(a.p)).map(x => `<tr><td class="l">${pl(x.p)}</td><td>${esc(x.p.pos || '')}</td><td>${YR_LABEL[x.p.yr]}</td><td>${ovrOf(x.p)}</td><td class="l">${WHY[x.why]}${x.why === 'pro' ? draftNote(x.p.id) : ''}${x.why === 'portal' ? ` — wants <b>$${retainAsk(S, x.p)}k</b> to stay <button class="btn ghost pg-sm" data-keep="${esc(x.p.id)}">Pay him</button> <button class="btn ghost pg-sm" data-talk="${esc(x.p.id)}" ${(O.talks && O.talks.tried[x.p.id]) || (O.talks && O.talks.used >= talksFor(S)) ? 'disabled' : ''}>Talk to him</button>${(m => m ? ` <span class="dim">(${esc(m.label.toLowerCase())}: ${letter(m.grade)}, expects ${letter(m.exp)})</span>` : '')(mood(S, x.p))}` : ''}</td></tr>`).join('')}</tbody></table></div>
        <div class="pg-d">NIL retention: a player headed for the portal names his price to stay. Your collective has <b>$${S.teams[U].prog ? S.teams[U].prog.nil.fund : 0}k</b>.${(O.kept || []).length ? ' Kept: ' + O.kept.map(k => `${esc(k.name)} ($${k.nil}k)`).join(', ') + '.' : ''}</div>` : '<div class="dy-empty">Nobody is leaving.</div>'}
      ${draftPanel()}
      <div class="dy-btns"><button class="btn" id="oNext">Open the transfer portal →</button></div>`;
    $('#dyBody').innerHTML = html;
    const nx = $('#oNext');
    nx.onclick = () => { processDepartures(S); autosave(); render(); };
    document.querySelectorAll('[data-realign]').forEach(b => b.onclick = () => { realignDecide(S, b.dataset.realign === '1'); autosave(); render(); });
    document.querySelectorAll('[data-talk]').forEach(b => b.onclick = () => { alert(talk(S, b.dataset.talk).msg); autosave(); render(); });
    document.querySelectorAll('[data-keep]').forEach(b => b.onclick = () => { const e = retain(S, b.dataset.keep); if (e) return alert(e); autosave(); render(); });
    return;
  }
  if (step === 'carousel') { CAL.head = html; carouselStep(CAL); return; }   // the coaching carousel (ui/carousel.js)
  if (step === 'staff') { CAL.head = html; staffStep(CAL); return; }         // the staff market
  if (step === 'portal') { CAL.head = html; portalView(CAL); return; }   // the live 10-day window (ui/portal.js)
  if (step === 'schedule') { CAL.head = html; scheduleStep(CAL); return; }   // next season's non-conference schedule (ui/sched.js)
  if (step === 'recruiting') {
    const R = O.recruits, B = O.board, max = open + 4, budget = O.budget || 100;   // the season's recruiting hours (Program tab)
    const used = () => Object.values(B).reduce((a, b) => a + (+b || 0), 0);
    // a recruit as YOUR staff sees him (scoutView: true ratings + his scouting error, tighter with a better
    // recruiting coordinator and more effort on him) — busts and diamonds in the rough are invisible here
    const recRow = (r, e) => { const v = scoutView(S, r, e + (r.vs || 0));   // + the long look his visits gave your staff
      return `<tr data-rrow="${esc(r.id)}"><td><input type="number" class="dy-min" min="0" max="60" step="5" data-eff="${esc(r.id)}" value="${e}"></td><td class="odds" data-odds="${esc(r.id)}"></td><td>${r.rank}</td>
        <td class="l"><b>${esc(r.name)}</b>${(S.visits || []).filter(x => x.rid === r.id && x.done).map(x => ` <span class="rv ${x.res}" title="${x.type === 'home' ? 'Home visit' : 'Official visit'}: ${x.res}">${x.type === 'home' ? '🏠' : '🎓'}</span>`).join('')}<div class="dy-tags">${v.tags.map(t => `<span>${esc(t)}</span>`).join('')}</div></td><td class="l">${stars(r.stars)}</td><td>${esc(r.pos || '')}</td><td>${r.ht ? `${Math.floor(r.ht / 12)}-${r.ht % 12}` : ''}</td>
        <td><b>${v.ovr}</b></td>${PILLARS.map(([k]) => `<td>${v.pillars[k]}</td>`).join('')}<td>${v.sta}</td><td><b>${v.grade}</b></td><td class="dim">±${v.sd}</td>
        <td>${esc(r.home === 'INTL' ? (r.country || 'Intl') : r.home || '')}</td><td title="Academics ${r.acad ?? ''}">${acadGrade(r.acad ?? 60)}</td><td class="${admitP(S, U, r, false) < 0.5 ? 'dn' : ''}">${admitLabel(admitP(S, U, r, false))}</td><td class="l rv-w">${priorities(profile(S, r)).map(x => `<span>${esc(x)}</span>`).join('')}</td><td>$${r.ask}k</td>
        <td class="l"><input type="number" class="dy-min rv-nil" min="0" step="5" data-nilb="${esc(r.id)}" value="${r.offer || ''}" placeholder="$k"><span class="rv-st ${r.nilState || ''}">${r.nilState === 'accepted' ? '✓' : r.nilState || ''}</span></td>
        <td class="l">${esc(short(pursuit(S, r, e).rival || ''))}</td></tr>`; };
    const got = (O.portalResults || []).filter(x => x.to === U);
    html += `${got.length ? `<div class="dy-next"><div class="lbl">From the portal</div><div class="ln">${got.map(x => `<b>${esc(x.name)}</b> (${x.ovr}, from ${esc(short(x.from))})`).join(' · ')}</div></div>` : ''}
      <div class="sec"><h2>Recruiting — class of ${S.year}</h2><span class="n">${open} open scholarship${open === 1 ? '' : 's'} · put up to ${max} recruits on your board and split ${budget} effort points (your recruiting hours this season). Ratings are your staff's scouting estimates — more effort on a recruit sharpens them (±). Some recruits will bust; some will blossom.</span></div>
      <div class="sheet-wrap"><table class="sheet dense heat dy-rec"><thead><tr><th>Effort</th><th>Odds</th><th>#</th><th class="l">Recruit</th><th class="l">Stars</th><th>Pos</th><th>Ht</th><th data-heat="1" title="Your staff's estimate of his overall">OVR</th>${PILLARS.map(([k, l]) => `<th data-heat="1" title="${l} (scouted)">${k}</th>`).join('')}<th data-heat="1" title="Stamina (scouted): how many minutes a night he can carry">STA</th><th title="Scouted potential: how much he should grow. Busts and diamonds in the rough hide here.">POT</th><th title="How sure your staff is (± rating points). Better recruiting coordinator and more effort on him = tighter.">±</th><th>From</th><th title="Academics">Acad</th><th title="Can your school admit him? Elite academic schools have a higher bar.">Admit</th><th class="l">Wants</th><th>Ask</th><th class="l" title="Your NIL offer ($k a year)">Offer</th><th class="l">Rival</th></tr></thead><tbody>
      ${R.slice(0, 300).map(r => recRow(r, B[r.id] || 0)).join('')}
      </tbody></table></div>
      <div class="dy-btns"><span class="dim" id="effN"></span><button class="btn" id="oNext">Signing day →</button><button class="btn ghost" id="oAuto">Let my staff handle it</button></div>`;
    $('#dyBody').innerHTML = html;
    const odds = () => {
      document.querySelectorAll('[data-odds]').forEach(td => { const r = R.find(x => x.id === td.dataset.odds), e = +B[r.id] || 0; const o = e ? landOdds(S, r, e) : 0;
        td.innerHTML = e ? `${Math.round(100 * o)}%${o >= 0.3 && o <= 0.7 ? `<div class="rv-bt" title="A close race — make a final push">⚔️ <button class="btn ghost pg-sm" data-push="${esc(r.id)}" ${(O.pushes ?? PUSHES) <= 0 || (r.pushN || 0) >= 2 ? 'disabled' : ''}>Push</button></div>` : ''}` : ''; });
      document.querySelectorAll('[data-push]').forEach(b => b.onclick = () => { const res = pushRecruit(S, b.dataset.push); alert(res.msg); autosave(); odds(); });
      $('#effN').textContent = `${Object.values(B).filter(v => v > 0).length} / ${max} on board · ${used()} / ${budget} effort · ${O.pushes ?? PUSHES} final pushes left`;
    };
    document.querySelectorAll('[data-nilb]').forEach(i => i.onchange = () => {
      const r = R.find(x => x.id === i.dataset.nilb); if (!r) return;
      const P = S.teams[U].prog, others = R.filter(x => x !== r && x.offer && x.nilState === 'accepted').reduce((s2, x) => s2 + x.offer, 0);
      if (P && others + (+i.value || 0) > P.nil.fund) { alert(`Your collective has $${P.nil.fund}k; $${others}k is already promised.`); i.value = r.offer || ''; return; }
      const res = negotiate(S, r, i.value); alert(res.msg); autosave(); render();
    });
    document.querySelectorAll('[data-eff]').forEach(i => i.onchange = () => {
      const v = Math.max(0, Math.min(60, +i.value || 0)), was = +B[i.dataset.eff] || 0;
      if (v && !was && Object.values(B).filter(x => x > 0).length >= max) { i.value = 0; return alert(`Your board holds up to ${max} recruits.`); }
      if (used() - was + v > budget) { i.value = was; return alert(`You only have ${budget} effort points.`); }
      B[i.dataset.eff] = v; odds(); autosave();
      const tr = document.querySelector(`[data-rrow="${CSS.escape(i.dataset.eff)}"]`), r = R.find(x => x.id === i.dataset.eff);
      if (tr && r) { tr.outerHTML = recRow(r, v); const ni = document.querySelector(`[data-eff="${CSS.escape(r.id)}"]`); if (ni) { ni.onchange = i.onchange; } odds(); if (window.tdcSheetHeat) tdcSheetHeat(document.querySelector('.dy-rec')); }
    }); odds();
    const go = () => run(() => resolveRecruiting(S));
    $('#oNext').onclick = go;
    $('#oAuto').onclick = () => {
      O.board = {}; const picks = R.map(r => ({ r, o: landOdds(S, r, 20) })).filter(x => x.o >= 0.4).slice(0, max);
      picks.forEach(x => { O.board[x.r.id] = Math.floor(budget / Math.max(1, picks.length)); }); go();
    };
    return;
  }
  // signing day results -> next season
  const sg = O.signed || [];
  const roster = S.teams[U].players.map(id => S.players[id]).filter(Boolean).sort((a, b) => ovrOf(b) - ovrOf(a));
  html += `<div class="sec"><h2>Signing day</h2><span class="n">${sg.filter(x => x.won).length} of ${sg.length} board targets signed</span></div>
    ${sg.length ? `<div class="sheet-wrap"><table class="sheet dense"><thead><tr><th>#</th><th class="l">Recruit</th><th class="l">Stars</th><th class="l">Decision</th></tr></thead><tbody>
      ${sg.map(x => `<tr><td>${x.rank}</td><td class="l"><b>${esc(x.name)}</b></td><td class="l">${stars(x.stars)}</td><td class="l">${x.won ? '<b class="w">Signed with you</b>' : x.denied ? '<span class="dn">Picked you — denied admission</span>' : '<span class="dim">Went elsewhere</span>'}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="sec"><h2>Your ${S.year}-${String(S.year + 1).slice(2)} roster</h2><span class="n">${roster.length} players · development happens when the new season starts</span></div>
    <div class="sheet-wrap"><table class="sheet dense heat dy-sign"><thead><tr><th class="l">Player</th><th>Pos</th><th>Yr</th><th data-heat="1">OVR</th>${PILLARS.map(([k, l]) => `<th data-heat="1" title="${l}">${k}</th>`).join('')}</tr></thead><tbody>
      ${roster.map(p => `<tr><td class="l">${pl(p)}${p.fresh ? ' <span class="chip new">new</span>' : ''}</td><td>${esc(p.pos || '')}</td><td>${p.fresh ? 'Fr' : YR_LABEL[Math.min(5, p.yr + 1)]}</td><td><b>${ovrOf(p)}</b></td>${PILLARS.map(([k]) => `<td>${p.pillars[k]}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div>
    <div class="dy-btns"><button class="btn" id="oNext">Build your schedule →</button></div>`;
  $('#dyBody').innerHTML = html;
  $('#oNext').onclick = () => { O.step = 'schedule'; autosave(); render(); };
}

// the draft (engine/draft.js): where the early entrants went + the first round
function draftNote(id) {
  const D = S.off && S.off.draft; if (!D) return '';
  const x = D.picks.find(p => p.id === id);
  return x ? ` — drafted <b>No. ${x.pick}</b> (${x.round === 1 ? '1st' : '2nd'} round)` : D.und.some(p => p.id === id) ? ' — undrafted, signed a pro deal' : '';
}
function draftPanel() {
  const D = S.off && S.off.draft; if (!D || !D.picks.length) return '';
  const back = D.withdrew.filter(x => x.team === S.user);
  return `<div class="sec"><h2>The draft</h2><span class="n">${D.picks.length} college players picked (the rest of the 60 picks went to international and G League players)${D.und.length ? ` · ${D.und.length} early entrants went undrafted` : ''} · ${D.withdrew.length} tested the waters and returned</span></div>
    ${back.length ? `<div class="pg-d"><b>Returning after testing the waters:</b> ${back.map(x => esc(x.name)).join(', ')}</div>` : ''}
    <div class="sheet-wrap"><table class="sheet dense dy-draft"><thead><tr><th>Pick</th><th class="l">Player</th><th class="l">School</th><th>Pos</th><th>Yr</th><th>OVR</th></tr></thead><tbody>
    ${D.picks.filter(x => x.round === 1 || x.team === S.user).map(x => `<tr class="${x.team === S.user ? 'me' : ''}"><td><b>${x.pick}</b>${x.round === 2 ? ' <span class="dim">R2</span>' : ''}</td><td class="l">${esc(x.name)}</td><td class="l">${tm(x.team)}</td><td>${esc(x.pos || '')}</td><td>${YR_LABEL[x.yr] || ''}</td><td>${x.ovr}</td></tr>`).join('')}
    </tbody></table></div>`;
}

// conference realignment (engine/realign.js): an invitation to the user's program + the league-wide moves
function realignPanel() {
  const inv = (S.off && S.off.invites) || [], x = inv.find(i => i.team === S.user && !i.done);
  const others = inv.filter(i => i.team !== S.user && i.decision === 'accept');
  const m = v => '$' + (v >= 1000 ? (v / 1000).toFixed(2) + 'M' : Math.round(v) + 'k');
  let h = '';
  if (x) {
    const I = inviteInfo(S, x), F = I.from, T = I.to;
    const row = (l, a, b) => `<tr><td class="l">${l}</td><td>${a}</td><td><b>${b}</b></td></tr>`;
    h += `<div class="dy-next rl-card"><div class="lbl">Conference realignment</div><div class="mu">The ${esc(T.conf)} has invited ${esc(short(S.user))} to join</div>
      <div class="ln">Leagues only call programs that keep winning — three straight seasons at or above their median member. It starts next season; you can change your mind until then.</div>
      <div class="rl-grid"><table class="pg-tbl"><thead><tr><th class="l"></th><th>${esc(F.conf)} (now)</th><th>${esc(T.conf)}</th></tr></thead><tbody>
        ${row('Tier', F.tier, T.tier)}${row('League value rank', '#' + F.rank, '#' + T.rank)}
        ${row('Your revenue / yr', m(F.rev), `${m(T.rev)}<div class="dim">year 1: ${m(T.yr1)}</div>`)}
        ${row('Avg trip to a league game', F.travel + ' mi', T.travel + ' mi')}
        ${row('You by power', `#${F.me.r} of ${F.me.n}`, `#${T.me.r} of ${T.me.n}`)}
        ${row('Contract', `through ${F.until}`, `through ${T.gor}`)}${row('Exit fee', '', I.fee ? m(I.fee) + ' <span class="dim">over 3 yrs</span>' : 'None')}</tbody></table>
      <div><ul class="rl-pc">${I.pro.map(t => `<li class="pro">${esc(t)}</li>`).join('')}${I.con.map(t => `<li class="con">${esc(t)}</li>`).join('')}</ul>
        <div class="dim rl-mem">${esc(T.conf)}: ${T.members.map(n => esc(short(n))).join(', ')}</div></div></div>
      <div class="dy-btns"><button class="btn ${x.decision === 'accept' ? '' : 'ghost'}" data-realign="1">${x.decision === 'accept' ? '✓ Accepted' : `Accept — join the ${esc(T.conf)}`}</button>
        <button class="btn ${x.decision === 'decline' ? '' : 'ghost'}" data-realign="0">${x.decision === 'decline' ? '✓ Declined' : `Decline — stay in the ${esc(F.conf)}`}</button></div></div>`;
  }
  if (others.length) h += `<div class="pg-d rl-moves"><b>Realignment this offseason:</b> ${others.map(i => `${tm(i.team)} ${esc(i.from)} → <b>${esc(i.to)}</b>`).join(' · ')} <span class="dim">(from next season)</span></div>`;
  return h;
}

function history() {
  const H = S.history, v = history.v || 'mine';
  const sub = `<div class="tn-tabs">${[['mine', 'Your program'], ['league', 'League history'], ['conf', 'Conference champions']].map(([k, l]) => `<button class="${v === k ? 'on' : ''}" data-hv="${k}">${l}</button>`).join('')}</div>`;
  const bind = () => document.querySelectorAll('[data-hv]').forEach(b => b.onclick = () => { history.v = b.dataset.hv; render(); });
  const LH = (S.leagueHist || []).slice().reverse(), yr = y => `${y - 1}-${String(y).slice(2)}`;
  if (v === 'league') {
    $('#dyBody').innerHTML = sub + `<div class="sec"><h2>League history</h2><span class="n">Every season of your dynasty</span></div>${LH.length ? `<div class="sheet-wrap"><table class="sheet dense"><thead><tr><th class="l">Season</th><th class="l">Champion</th><th class="l">Coach</th><th>Record</th><th class="l">Title game</th><th class="l">Final Four</th><th class="l">Player of the Year</th><th class="l">Coach of the Year</th><th class="l">NIT</th><th class="l">CBI</th></tr></thead><tbody>
      ${LH.map(h => `<tr class="${h.champ === S.user ? 'me' : ''}"><td class="l">${yr(h.y)}</td><td class="l">${h.champ ? tm(h.champ) : ''}</td><td class="l">${esc(h.coach || '')}</td><td>${h.rec || ''}</td><td class="l">${h.final ? `${esc(short(h.final.w))} ${esc(h.final.s)} ${esc(short(h.final.l))}` : ''}</td><td class="l dim">${h.ff.map(t => esc(short(t))).join(', ')}</td><td class="l">${h.poy ? `${esc(h.poy.name)} <span class="dim">${esc(short(h.poy.team))}</span>` : ''}</td><td class="l">${h.coy ? `${esc(h.coy.name || '')} <span class="dim">${esc(short(h.coy.team))}</span>` : ''}</td><td class="l">${h.nit ? esc(short(h.nit)) : ''}</td><td class="l">${h.cbi ? esc(short(h.cbi)) : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="dy-empty">Finish a season to start the record books.</div>'}`;
    return bind();
  }
  if (v === 'conf') {
    const cs = [...new Set(LH.flatMap(h => Object.keys(h.conf || {})))].sort(), sel = history.conf && cs.includes(history.conf) ? history.conf : S.teams[S.user].conf;
    $('#dyBody').innerHTML = sub + `<div class="sec"><h2>Conference champions</h2><select id="hcSel" class="dy-input sm">${cs.map(c => `<option ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>${LH.length ? `<div class="sheet-wrap"><table class="sheet dense"><thead><tr><th class="l">Season</th><th class="l">Regular season</th><th class="l">Tournament</th></tr></thead><tbody>
      ${LH.filter(h => h.conf && h.conf[sel]).map(h => `<tr><td class="l">${yr(h.y)}</td><td class="l">${tm(h.conf[sel].reg)}</td><td class="l">${h.conf[sel].tour ? tm(h.conf[sel].tour) : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="dy-empty">Finish a season first.</div>'}`;
    const hs = $('#hcSel'); if (hs) hs.onchange = e => { history.conf = e.target.value; render(); };
    return bind();
  }
  $('#dyBody').innerHTML = sub + `<div class="sec"><h2>Program history</h2></div>${H.length ? `<div class="sheet-wrap"><table class="sheet dense dy-hist"><thead><tr><th class="l">Season</th><th class="l">Program</th><th>Record</th><th>Conf</th><th>Final power</th><th class="l">March</th><th class="l">Champion</th><th class="l">National POY</th></tr></thead><tbody>
    ${H.slice().reverse().map(h => `<tr><td class="l">${h.year - 1}-${String(h.year).slice(2)}</td><td class="l">${tm(h.user.team)}</td><td>${h.user.w}-${h.user.l}</td><td>${h.user.cw}-${h.user.cl}</td><td>#${h.user.rank}</td><td class="l">${esc(h.user.post)}</td><td class="l">${tm(h.champ)}</td><td class="l">${h.awards && h.awards.poy ? esc(h.awards.poy.name) : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="dy-empty">Finish a season to start your program\'s history.</div>'}`;
  bind();
}

// boot
startScreen().catch(e => { $('#dyBody').innerHTML = `<div class="dy-empty">Couldn't load the dynasty: ${esc(e.message || e)}</div>`; });
