// Dynasty — the page. Engine (pure) + browser saves + rendering. One league in memory (S); every action
// mutates it through the engine, re-renders, and autosaves.
import { C } from '../engine/constants.js?v=10';
import { createLeague, hydrate, dehydrate, YR_LABEL, effOvr } from '../engine/league.js?v=10';
import { overall } from '../engine/ratings.js?v=10';
import { prepared, playGame, nextDate, power, poll, standings, record_, lineFor, touch } from '../engine/season.js?v=10';
import { simNext, simTo, afterDay } from '../engine/flow.js?v=10';
import { REGION_NAMES, ncaaResult } from '../engine/postseason.js?v=10';
import { takeJob } from '../engine/coaching.js?v=10';
import { TYPES as INJ } from '../engine/injuries.js?v=10';
import { beginOffseason, processDepartures, resolvePortal, resolveRecruiting, startNextSeason, openSpots, landOdds, SCHOLARSHIPS } from '../engine/offseason.js?v=10';
import { saveSlot, loadSlot, listSlots, removeSlot } from './store.js?v=10';
import { lines as pbpLines } from './pbp.js?v=10';

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

let S = null, slot = null, cache = {}, SNAP = null, SCHED = null, tab = 'home', busy = false;
const ovrOf = p => Math.round(effOvr(p, S));   // competition-adjusted: a low-major 84 shows ~75

// ── data + saves ──
async function loadData() {
  if (SNAP) return;
  $('#dyBody').innerHTML = '<div class="dy-empty">Loading the league…</div>';
  [SNAP, SCHED] = await Promise.all([
    fetch('data/dynasty-snapshot.json?v=2').then(r => r.json()),
    fetch('scripts/data/schedule_2027.json?v=5').then(r => r.json()),
  ]);
}
function meta() {
  const r = record_(S, S.user);
  return { team: S.user, year: S.year, w: r.w, l: r.l, phase: S.phase };
}
let saveT = null;
function autosave() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { saveSlot(slot, dehydrate(S), meta()).catch(e => console.warn('save failed', e)); }, 300);
}

// ── start screen ──
async function startScreen() {
  $('#dyHead').innerHTML = '<div class="eyebrow">Dynasty · beta</div><h1>Dynasty</h1>';
  const saves = await listSlots().catch(() => []);
  await loadData();
  const body = $('#dyBody');
  body.innerHTML = `
    ${saves.length ? `<div class="sec"><h2>Continue</h2></div>
      <div class="sheet-wrap"><table class="sheet dense dy-saves"><thead><tr><th class="l">Program</th><th>Season</th><th>Record</th><th class="l">Stage</th><th class="l">Saved</th><th></th></tr></thead><tbody>
      ${saves.map(s => `<tr><td class="l">${tm(s.meta.team)}</td><td>${s.meta.year - 1}-${String(s.meta.year).slice(2)}</td><td>${s.meta.w}-${s.meta.l}</td>
        <td class="l">${esc(phaseLabel(s.meta.phase))}</td><td class="l dim">${new Date(s.at).toLocaleString()}</td>
        <td><button class="btn" data-load="${esc(s.slot)}">Continue</button> <button class="btn ghost" data-del="${esc(s.slot)}" title="Delete this save">✕</button></td></tr>`).join('')}
      </tbody></table></div>` : ''}
    <div class="sec"><h2>New dynasty</h2><span class="n">Pick a program. You start with its real 2026-27 roster and schedule.</span></div>
    <div class="dy-row"><input id="dyCoach" class="dy-input" placeholder="Your name (head coach)" maxlength="40" autocomplete="off"><input id="dySearch" class="dy-input" placeholder="Search programs…" autocomplete="off"></div>
    <div id="dyPick" class="dy-pick"></div>`;
  body.querySelectorAll('[data-load]').forEach(b => b.onclick = () => openSave(b.dataset.load));
  body.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this dynasty save? This cannot be undone.')) return;
    await removeSlot(b.dataset.del); startScreen();
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
  S = hydrate(createLeague(SNAP, SCHED, { user: team, now: Date.now(), coachName: cn }));
  slot = 'dyn-' + Date.now();
  cache = {}; touch(S); tab = 'home';
  await saveSlot(slot, dehydrate(S), meta());
  render();
}
async function openSave(s) {
  const rec = await loadSlot(s); if (!rec) return startScreen();
  S = hydrate(JSON.parse(rec.json)); slot = s; cache = {}; touch(S); tab = 'home';
  render();
}

// ── chrome ──
function phaseLabel(p) {
  return { regular: 'Regular season', conftourney: 'Conference tournaments', ncaa: 'NCAA tournament', done: 'Season complete', offseason: 'Offseason' }[p] || p;
}
const TABS = [['home', 'Home'], ['schedule', 'Schedule'], ['roster', 'Roster'], ['plan', 'Game plan'], ['standings', 'Standings'], ['rankings', 'Rankings'], ['leaders', 'Leaders'], ['post', 'Postseason'], ['awards', 'Awards'], ['news', 'News'], ['history', 'History']];
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
      <div class="dy-acts"><button class="btn ghost" id="dyExit">Saves</button></div></div>
    <nav class="dy-tabs">${(S.phase === 'offseason' ? [['off', 'Offseason']] : []).concat(TABS).map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</nav>`;
  $('#dyExit').onclick = () => { S = null; startScreen(); };
  $('#dyHead').querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });
  if (S.phase === 'offseason' && tab === 'home') tab = 'off';
  ({ home, schedule, roster, plan, standings: standingsView, rankings, leaders, post, history, off: offseason, awards: awardsView, news: newsView })[tab]();
  document.querySelectorAll('#dyBody table.heat').forEach(x => window.tdcSheetHeat && tdcSheetHeat(x));
}

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
      <div class="ln">${esc(short(S.user))}: ${esc(ncaaResult(S, S.user) || 'missed the NCAA tournament')}</div>
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
  const sim = playGame(S, g, prep, C, { log: true });
  autosave();
  const names = {}; for (const r of sim.box.home.concat(sim.box.away)) names[r.id] = r.name;
  const L = pbpLines(sim.events, id => names[id] || '?', [g.h, g.a]);
  const ov = document.createElement('div'); ov.className = 'dy-ov';
  ov.innerHTML = `<div class="dy-watch"><div class="dy-sb"><div>${tm(g.a)}<b id="sA">0</b></div><div class="clk"><span id="sP">1st</span><b id="sC">20:00</b></div><div><b id="sH">0</b>${tm(g.h)}</div></div>
    <div class="dy-speed">Speed <button data-sp="700">Live</button><button data-sp="140" class="on">Fast</button><button data-sp="25">Faster</button><button data-sp="0">Skip to end</button></div>
    <div class="dy-feed" id="feed"></div><div class="dy-btns"><button class="btn" id="wDone" disabled>Final — continue</button></div></div>`;
  document.body.appendChild(ov);
  let i = 0, sp = 140, timer = null;
  const feed = ov.querySelector('#feed');
  const step = () => {
    if (i >= L.length) { clearInterval(timer); finish(); return; }
    const l = L[i++];
    ov.querySelector('#sH').textContent = l.score[0]; ov.querySelector('#sA').textContent = l.score[1];
    ov.querySelector('#sP').textContent = l.period; ov.querySelector('#sC').textContent = l.clock;
    if (!l.sub || sp >= 140) {
      const row = document.createElement('div'); row.className = 'pl' + (l.pts ? ' sc' : '') + (l.sub ? ' sub' : '');
      row.innerHTML = `<span class="t">${l.period} ${l.clock}</span><img src="${esc(logo(l.team))}" alt=""><span>${esc(l.txt)}</span><span class="s">${l.score[1]}-${l.score[0]}</span>`;
      feed.prepend(row);
    }
  };
  const go = () => { clearInterval(timer); if (sp === 0) { while (i < L.length) step(); step(); } else timer = setInterval(step, sp); };
  ov.querySelectorAll('[data-sp]').forEach(b => b.onclick = () => { ov.querySelectorAll('[data-sp]').forEach(x => x.classList.remove('on')); b.classList.add('on'); sp = +b.dataset.sp; go(); });
  const finish = () => {
    const done = ov.querySelector('#wDone'); done.disabled = false;
    ov.querySelector('#sP').textContent = 'Final' + (sim.ot ? (sim.ot > 1 ? ` (${sim.ot}OT)` : ' (OT)') : ''); ov.querySelector('#sC').textContent = '';
    feed.insertAdjacentHTML('afterbegin', boxHtml(g, { box: sim.box, score: sim.score, ot: sim.ot }));
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
function schedule() {
  const mine = S.schedule.filter(g => g.h === S.user || g.a === S.user);
  const pw = power(S);
  $('#dyBody').innerHTML = `<div class="sec"><h2>Schedule</h2><span class="n">${mine.length} games · click a played game for its box score</span></div>
  <div class="sheet-wrap"><table class="sheet dense dy-s"><thead><tr><th class="l">Date</th><th class="l">Opponent</th><th>Opp power</th><th>Line</th><th>Result</th><th class="l"></th></tr></thead><tbody>
  ${mine.map(g => {
    const home = g.h === S.user, opp = home ? g.a : g.h, sp = lineFor(S, g, pw) * (home ? 1 : -1);
    let res = '';
    if (g.r) { const us = home ? g.r[0] : g.r[1], them = home ? g.r[1] : g.r[0]; res = `<b class="${us > them ? 'w' : 'l'}">${us > them ? 'W' : 'L'}</b> ${us}-${them}${g.r[2] ? ' OT' : ''}`; }
    return `<tr class="${g.r && S.userBox[g.id] ? 'go' : ''}" data-box="${esc(g.id)}"><td class="l">${fmtDate(g.d)}</td><td class="l">${g.n ? 'vs' : home ? 'vs' : '@'} ${tm(opp)}</td>
      <td>${pw[opp].toFixed(1)}</td><td>${g.r ? '' : (sp >= 0 ? '−' : '+') + Math.abs(sp).toFixed(1)}</td><td>${res}</td><td class="l dim">${g.t === 'ct' ? 'Conf. tourney' : g.t === 'ncaa' ? 'NCAA' : g.c ? 'Conf' : ''}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function roster() {
  const t = S.teams[S.user];
  const prep = prepared(S, C, cache).teams[S.user];
  const auto = Object.fromEntries(prep.roster.map(p => [p.id, p.target]));
  const ps = t.players.map(id => S.players[id]).filter(Boolean).sort((a, b) => (auto[b.id] || 0) - (auto[a.id] || 0));
  const starters = new Set(t.starters || prep.roster.slice(0, 5).map(p => p.id));
  const stat = (id, k) => { const s = S.stats[id]; return s && s.g ? (s[k] / s.g).toFixed(1) : '—'; };
  $('#dyBody').innerHTML = `<div class="sec"><h2>Roster</h2><span class="n">Set starters (exactly five) and minutes per game — the sim plays your rotation. Minutes are scaled to 200 per game.</span></div>
  <div class="sheet-wrap"><table class="sheet dense heat dy-roster"><thead><tr><th class="l">Player</th><th>Pos</th><th>Yr</th><th>Ht</th><th data-heat="1" title="Overall, adjusted for the level of competition the player's ratings came from">OVR</th>
    ${PILLARS.map(([k, l]) => `<th data-heat="1" title="${l}">${k}</th>`).join('')}<th>Start</th><th>Min</th><th>MPG</th><th>PPG</th><th>RPG</th><th>APG</th></tr></thead><tbody>
  ${ps.map(p => `<tr class="${p.out > 0 ? 'hurt' : ''}"><td class="l">${pl(p)}${p.out > 0 ? ` <span class="chip" title="${esc(p.inj ? p.inj.type : '')}">OUT ${p.out >= 99 ? 'season' : p.out + 'g'}</span>` : ''}${(() => { const d = S.lastOff && S.lastOff.progress && S.lastOff.progress[p.id]; return d ? ` <span class="${d > 0 ? 'up' : 'dn'}">${d > 0 ? '+' : ''}${d}</span>` : ''; })()}</td><td>${esc(p.pos || '')}</td><td>${YR_LABEL[p.yr] || ''}</td><td>${p.ht ? `${Math.floor(p.ht / 12)}-${p.ht % 12}` : ''}</td><td><b>${ovrOf(p)}</b></td>
    ${PILLARS.map(([k]) => `<td>${p.pillars[k]}</td>`).join('')}
    <td><input type="checkbox" data-st="${esc(p.id)}" ${starters.has(p.id) ? 'checked' : ''}></td>
    <td><input type="number" class="dy-min" min="0" max="40" step="1" data-min="${esc(p.id)}" value="${Math.round(t.minutes && t.minutes[p.id] != null ? t.minutes[p.id] : (auto[p.id] || 0))}"></td>
    <td>${stat(p.id, 'min')}</td><td>${stat(p.id, 'pts')}</td><td>${(() => { const s = S.stats[p.id]; return s && s.g ? ((s.orb + s.drb) / s.g).toFixed(1) : '—'; })()}</td><td>${stat(p.id, 'ast')}</td></tr>`).join('')}
  </tbody></table></div>
  <div class="dy-btns"><span id="minSum" class="dim"></span><button class="btn" id="rSave">Save rotation</button><button class="btn ghost" id="rAuto">Reset to the coach's default</button></div>`;
  const sum = () => { let s = 0; document.querySelectorAll('[data-min]').forEach(i => s += +i.value || 0); $('#minSum').textContent = `Total ${s} min (scaled to 200)`; };
  document.querySelectorAll('[data-min]').forEach(i => i.oninput = sum); sum();
  $('#rSave').onclick = () => {
    const st = [...document.querySelectorAll('[data-st]:checked')].map(i => i.dataset.st);
    if (st.length !== 5) return alert(`Pick exactly five starters (you have ${st.length}).`);
    const m = {}; document.querySelectorAll('[data-min]').forEach(i => { m[i.dataset.min] = Math.max(0, Math.min(40, +i.value || 0)); });
    if (st.some(id => !m[id])) return alert('Every starter needs minutes.');
    t.starters = st; t.minutes = m; touch(S); autosave(); render();
  };
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
  <div class="sheet-wrap"><table class="sheet dense"><thead><tr><th>#</th><th class="l">Team</th><th>Conf</th><th>Overall</th><th>Power</th></tr></thead><tbody>
  ${(() => { const pw = power(S); return st[sel].map((r, i) => `<tr class="${r.team === S.user ? 'me' : ''}"><td>${i + 1}</td><td class="l">${tm(r.team)}</td><td>${r.cw}-${r.cl}</td><td>${r.w}-${r.l}</td><td>${pw[r.team].toFixed(1)}</td></tr>`).join(''); })()}
  </tbody></table></div>`;
  $('#cSel').onchange = e => { standingsView.conf = e.target.value; render(); };
}

function rankings() {
  const pw = power(S), all = Object.keys(pw).sort((a, b) => pw[b] - pw[a]);
  $('#dyBody').innerHTML = `<div class="sec"><h2>Power rankings</h2><span class="n">Opponent-adjusted scoring margin, blended with the preseason roster rating early in the year</span></div>
  <div class="sheet-wrap"><table class="sheet dense heat dy-rk"><thead><tr><th>#</th><th class="l">Team</th><th class="l">Conf</th><th>Rec</th><th data-heat="1">Power</th></tr></thead><tbody>
  ${all.map((t, i) => { const r = record_(S, t); return `<tr class="${t === S.user ? 'me' : ''}"><td>${i + 1}</td><td class="l">${tm(t)}</td><td class="l dim">${esc(S.teams[t].conf)}</td><td>${r.w}-${r.l}</td><td>${pw[t].toFixed(1)}</td></tr>`; }).join('')}
  </tbody></table></div>`;
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

function post() {
  if (!S.post) { $('#dyBody').innerHTML = '<div class="dy-empty">Conference tournaments start when the regular season ends.</div>'; return; }
  const conf = S.post.conf, mine = S.teams[S.user].conf;
  const N = S.post.ncaa;
  const slotTxt = s => !s ? '' : s.team ? `<span class="sd">${s.seed}</span>${tm(s.team)}` : '';
  const gameTxt = s => {
    if (!s) return '<div class="bg empty">—</div>';
    if (s.team) return `<div class="bg"><div class="w">${slotTxt(s)}</div></div>`;
    const g = S.schedule.find(x => x.id === s.game), r = g && g.r;
    const row = (t, pts, won) => `<div class="${r ? (won ? 'w' : 'l') : ''}"><span class="sd">${t.seed}</span>${tm(t.team, t.team === S.user ? 'me' : '')}<b>${r ? pts : ''}</b></div>`;
    return `<div class="bg">${row(s.h, r && r[0], r && r[0] > r[1])}${row(s.a, r && r[1], r && r[1] > r[0])}</div>`;
  };
  const bracket = (br, from = 1) => `<div class="dy-br">${br.rounds.slice(from).map((rd, i) => `<div class="col"><div class="rh">${roundName(br, i + from)}</div>${rd.map(gameTxt).join('')}</div>`).join('')}</div>`;
  let html = '';
  if (N) {
    html += `<div class="sec"><h2>NCAA tournament</h2><span class="n">${N.champ ? '🏆 ' + esc(short(N.champ)) : ''}</span></div>
      <div class="dy-ff"><b>First Four</b> ${N.firstFour.map(f => gameTxt(f.slot)).join('')}</div>`;
    if (N.main) html += bracket(N.main);
    else html += `<div class="dy-empty">The field of 64 is set once the First Four is played.</div>`;
  }
  const sel = post.conf || mine;
  html += `<div class="sec"><h2>Conference tournaments</h2><select id="ctSel" class="dy-input sm">${Object.keys(conf).sort().map(c => `<option ${c === sel ? 'selected' : ''}>${esc(c)}${conf[c].champ ? ' — ' + esc(short(conf[c].champ)) : ''}</option>`).join('')}</select></div>`;
  if (conf[sel]) html += bracket(conf[sel]);
  $('#dyBody').innerHTML = html;
  const cs = $('#ctSel'); if (cs) cs.onchange = e => { post.conf = e.target.value.split(' — ')[0]; render(); };
}
function roundName(br, rd) {
  const R = br.rounds[rd] || [], left = R.length;
  if (left === 1 && R[0] && R[0].team) return 'Champion';
  if (br.kind === 'ncaa') return { 32: 'Round of 64', 16: 'Round of 32', 8: 'Sweet 16', 4: 'Elite Eight', 2: 'Final Four', 1: 'Championship' }[left] || '';
  return left === 1 ? 'Final' : left === 2 ? 'Semifinals' : left === 4 ? 'Quarterfinals' : `Round ${rd}`;
}

// ── news, awards, player cards ──
const NICON = { injury: '🩹', return: '✅', award: '🏆', coach: '📋', title: '🏆' };
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

function awardsList(A) {
  if (!A) return '<div class="dy-empty">Awards are announced when the season ends.</div>';
  const row = (lbl, x) => x ? `<tr><td class="l"><b>${lbl}</b></td><td class="l">${S.players[x.id] ? pl(S.players[x.id], false) : esc(x.name)}</td><td class="l">${tm(x.team)}</td><td>${x.ppg ?? ''}</td><td>${x.rpg ?? ''}</td><td>${x.apg ?? ''}</td></tr>` : '';
  return `<div class="sheet-wrap"><table class="sheet dense dy-aw"><thead><tr><th class="l">Award</th><th class="l">Player</th><th class="l">Team</th><th>PPG</th><th>RPG</th><th>APG</th></tr></thead><tbody>
    ${row('National Player of the Year', A.poy)}${row('Defensive Player of the Year', A.dpoy)}${row('Freshman of the Year', A.fr)}
    ${A.aa1.map((x, i) => row(i ? '' : 'All-America 1st team', x)).join('')}${A.aa2.map((x, i) => row(i ? '' : 'All-America 2nd team', x)).join('')}
    ${A.coy ? `<tr><td class="l"><b>Coach of the Year</b></td><td class="l">${esc(A.coy.coach || '')}</td><td class="l">${tm(A.coy.team)}</td><td colspan="3">${A.coy.w}-${A.coy.l}</td></tr>` : ''}
  </tbody></table></div>
  <div class="sec"><h2>Conference players of the year</h2></div><div class="sheet-wrap"><table class="sheet dense dy-awc"><thead><tr><th class="l">Conference</th><th class="l">Player</th><th class="l">Team</th><th>PPG</th></tr></thead><tbody>
    ${Object.entries(A.conf).sort().map(([c, x]) => `<tr class="${x.team === S.user ? 'me' : ''}"><td class="l">${esc(c)}</td><td class="l">${S.players[x.id] ? pl(S.players[x.id], false) : esc(x.name)}</td><td class="l">${tm(x.team)}</td><td>${x.ppg}</td></tr>`).join('')}
  </tbody></table></div>`;
}
function awardsView() {
  const A = S.awards || (S.history.at(-1) && S.history.at(-1).awards);
  $('#dyBody').innerHTML = `<div class="sec"><h2>${A ? `${A.year - 1}-${String(A.year).slice(2)} awards` : 'Awards'}</h2></div>${awardsList(A)}`;
}

function playerCard(id) {
  const p = S.players[id]; if (!p) return;
  const s = S.stats[id], line = s && s.g ? `${s.g} G · ${(s.min / s.g).toFixed(1)} MPG · ${(s.pts / s.g).toFixed(1)} PPG · ${((s.orb + s.drb) / s.g).toFixed(1)} RPG · ${(s.ast / s.g).toFixed(1)} APG · ${s.fga ? (100 * s.fgm / s.fga).toFixed(1) : '—'} FG% · ${s.tpa ? (100 * s.tpm / s.tpa).toFixed(1) : '—'} 3P%` : 'No games this season';
  const awards = [];
  for (const h of S.history) { const A = h.awards; if (!A) continue; const yr = `${h.year - 1}-${String(h.year).slice(2)}`;
    if (A.poy && A.poy.id === id) awards.push(`National POY ${yr}`); if (A.dpoy && A.dpoy.id === id) awards.push(`DPOY ${yr}`); if (A.fr && A.fr.id === id) awards.push(`Freshman of the Year ${yr}`);
    if (A.aa1.some(x => x && x.id === id)) awards.push(`1st-team All-American ${yr}`); else if (A.aa2.some(x => x && x.id === id)) awards.push(`2nd-team All-American ${yr}`);
    if (Object.values(A.conf).some(x => x.id === id)) awards.push(`Conference POY ${yr}`); }
  const ov = document.createElement('div'); ov.className = 'dy-ov';
  ov.innerHTML = `<div class="dy-watch dy-card"><div class="hd">${p.team ? `<img src="${esc(logo(p.team))}" alt="">` : ''}<div><div class="eyebrow">${esc(p.team ? short(p.team) : 'Transfer portal')} · ${esc(p.pos || '')} · ${YR_LABEL[p.yr] || ''}${p.ht ? ` · ${Math.floor(p.ht / 12)}-${p.ht % 12}` : ''}${p.stars ? ` · ${'★'.repeat(p.stars)} recruit` : ''}</div>
      <h2>${esc(p.name)}</h2><div class="dim">${line}</div>${p.out > 0 ? `<div class="hurt">🩹 ${esc(p.inj ? p.inj.type : 'Injured')} — ${p.out >= 99 ? 'out for the season' : `out ${p.out} game${p.out > 1 ? 's' : ''}`}</div>` : ''}</div><div class="ovr"><b>${ovrOf(p)}</b><span>OVR</span></div></div>
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
  const steps = [['departures', 'Departures'], ['portal', 'Transfer portal'], ['recruiting', 'Recruiting'], ['ready', 'Signing day']];
  let html = `<div class="dy-steps">${steps.map(([k, l], i) => `<span class="${k === step ? 'on' : steps.findIndex(x => x[0] === step) > i ? 'done' : ''}">${i + 1}. ${l}</span>`).join('')}</div>`;
  if (step === 'departures') {
    const mine = Object.entries(O.leaving).map(([id, why]) => ({ p: S.players[id], why })).filter(x => x.p && x.p.team === U);
    const all = Object.values(O.leaving), c = w => all.filter(x => x === w).length;
    const h = S.history.at(-1);
    html += `<div class="dy-next"><div class="lbl">${S.year - 1}-${String(S.year).slice(2)} in review</div><div class="mu">${esc(short(U))} ${h.user.w}-${h.user.l} · ${esc(h.user.post)} · final power #${h.user.rank}</div>
      <div class="ln">Champion: ${tm(h.champ)} · Prestige now ${S.teams[U].prestige}/100${h.awards && h.awards.poy ? ` · National POY: ${esc(h.awards.poy.name)} (${esc(short(h.awards.poy.team))})` : ''}</div></div>
      ${jobPanel()}
      <div class="sec"><h2>Leaving ${esc(short(U))}</h2><span class="n">League-wide: ${c('graduated')} graduated, ${c('pro')} turned pro, ${c('portal')} entered the portal</span></div>
      ${mine.length ? `<div class="sheet-wrap"><table class="sheet dense"><thead><tr><th class="l">Player</th><th>Pos</th><th>Yr</th><th>OVR</th><th class="l">Why</th></tr></thead><tbody>
        ${mine.sort((a, b) => ovrOf(b.p) - ovrOf(a.p)).map(x => `<tr><td class="l">${pl(x.p)}</td><td>${esc(x.p.pos || '')}</td><td>${YR_LABEL[x.p.yr]}</td><td>${ovrOf(x.p)}</td><td class="l">${WHY[x.why]}</td></tr>`).join('')}</tbody></table></div>` : '<div class="dy-empty">Nobody is leaving.</div>'}
      <div class="dy-btns"><button class="btn" id="oNext">Open the transfer portal →</button></div>`;
    $('#dyBody').innerHTML = html;
    document.querySelectorAll('[data-take]').forEach(b => b.onclick = () => {
      const t = b.dataset.take;
      if (!confirm(`Take the ${short(t)} job? You'll leave ${short(S.user)} and take over ${short(t)}'s roster.`)) return;
      takeJob(S, t); tab = 'off'; cache = {}; autosave(); render();
    });
    const nx = $('#oNext');
    if (S.job && S.job.fired) { nx.disabled = true; nx.title = 'Pick your next job first'; }
    nx.onclick = () => { processDepartures(S); autosave(); render(); };
    return;
  }
  if (step === 'portal') {
    const pool = O.portal.map(id => S.players[id]).filter(Boolean);
    const max = open + 3, n = () => Object.keys(O.offers).filter(k => O.offers[k]).length;
    html += `<div class="sec"><h2>Transfer portal</h2><span class="n">${pool.length} players · you have <b>${open}</b> open scholarship${open === 1 ? '' : 's'} (of ${SCHOLARSHIPS}) · offer up to ${max}. Players weigh your prestige and the minutes they'd get.</span></div>
      <div class="sheet-wrap"><table class="sheet dense heat dy-portal"><thead><tr><th>Offer</th><th class="l">Player</th><th class="l">From</th><th>Pos</th><th>Yr</th><th>Ht</th><th data-heat="1">OVR</th>${PILLARS.map(([k, l]) => `<th data-heat="1" title="${l}">${k}</th>`).join('')}</tr></thead><tbody>
      ${pool.slice(0, 250).map(p => `<tr><td><input type="checkbox" data-offer="${esc(p.id)}" ${O.offers[p.id] ? 'checked' : ''}></td><td class="l">${pl(p)}</td><td class="l">${tm(p.from)}</td><td>${esc(p.pos || '')}</td><td>${YR_LABEL[Math.min(5, p.yr + 1)]}</td><td>${p.ht ? `${Math.floor(p.ht / 12)}-${p.ht % 12}` : ''}</td><td><b>${ovrOf(p)}</b></td>${PILLARS.map(([k]) => `<td>${p.pillars[k]}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>
      <div class="dy-btns"><span class="dim" id="offN"></span><button class="btn" id="oNext">Make offers & close the portal →</button><button class="btn ghost" id="oAuto">Let my staff handle it</button></div>`;
    $('#dyBody').innerHTML = html;
    const cnt = () => { $('#offN').textContent = `${n()} / ${max} offers`; };
    document.querySelectorAll('[data-offer]').forEach(i => i.onchange = () => {
      if (i.checked && n() >= max) { i.checked = false; return alert(`You can make up to ${max} offers.`); }
      O.offers[i.dataset.offer] = i.checked; cnt(); autosave();
    }); cnt();
    const go = () => run(() => resolvePortal(S));
    $('#oNext').onclick = go;
    $('#oAuto').onclick = () => {
      const os = S.teams[U].players.map(id => ovrOf(S.players[id])).sort((a, b) => b - a), bar = os[7] ?? 60;
      O.offers = {}; pool.filter(p => ovrOf(p) > bar).slice(0, max).forEach(p => { O.offers[p.id] = true; });
      go();
    };
    return;
  }
  if (step === 'recruiting') {
    const R = O.recruits, B = O.board, max = open + 4, budget = 100;
    const used = () => Object.values(B).reduce((a, b) => a + (+b || 0), 0);
    const got = (O.portalResults || []).filter(x => x.to === U);
    html += `${got.length ? `<div class="dy-next"><div class="lbl">From the portal</div><div class="ln">${got.map(x => `<b>${esc(x.name)}</b> (${x.ovr}, from ${esc(short(x.from))})`).join(' · ')}</div></div>` : ''}
      <div class="sec"><h2>Recruiting — class of ${S.year}</h2><span class="n">${open} open scholarship${open === 1 ? '' : 's'} · put up to ${max} recruits on your board and split ${budget} effort points. OVR is your staff's scouting estimate.</span></div>
      <div class="sheet-wrap"><table class="sheet dense heat dy-rec"><thead><tr><th>Effort</th><th>Odds</th><th>#</th><th class="l">Recruit</th><th class="l">Stars</th><th>Pos</th><th>Ht</th><th data-heat="1">OVR (scouted)</th>${PILLARS.map(([k, l]) => `<th data-heat="1" title="${l}">${k}</th>`).join('')}</tr></thead><tbody>
      ${R.slice(0, 300).map(r => `<tr><td><input type="number" class="dy-min" min="0" max="60" step="5" data-eff="${esc(r.id)}" value="${B[r.id] || 0}"></td><td class="odds" data-odds="${esc(r.id)}"></td><td>${r.rank}</td><td class="l"><b>${esc(r.name)}</b></td><td class="l">${stars(r.stars)}</td><td>${esc(r.pos || '')}</td><td>${r.ht ? `${Math.floor(r.ht / 12)}-${r.ht % 12}` : ''}</td><td><b>${r.scout}</b></td>${PILLARS.map(([k]) => `<td>${r.pillars[k]}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>
      <div class="dy-btns"><span class="dim" id="effN"></span><button class="btn" id="oNext">Signing day →</button><button class="btn ghost" id="oAuto">Let my staff handle it</button></div>`;
    $('#dyBody').innerHTML = html;
    const odds = () => {
      document.querySelectorAll('[data-odds]').forEach(td => { const r = R.find(x => x.id === td.dataset.odds), e = +B[r.id] || 0; td.textContent = e ? Math.round(100 * landOdds(S, r, e)) + '%' : ''; });
      $('#effN').textContent = `${Object.values(B).filter(v => v > 0).length} / ${max} on board · ${used()} / ${budget} effort`;
    };
    document.querySelectorAll('[data-eff]').forEach(i => i.onchange = () => {
      const v = Math.max(0, Math.min(60, +i.value || 0)), was = +B[i.dataset.eff] || 0;
      if (v && !was && Object.values(B).filter(x => x > 0).length >= max) { i.value = 0; return alert(`Your board holds up to ${max} recruits.`); }
      if (used() - was + v > budget) { i.value = was; return alert(`You only have ${budget} effort points.`); }
      B[i.dataset.eff] = v; odds(); autosave();
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
      ${sg.map(x => `<tr><td>${x.rank}</td><td class="l"><b>${esc(x.name)}</b></td><td class="l">${stars(x.stars)}</td><td class="l">${x.won ? '<b class="w">Signed with you</b>' : '<span class="dim">Went elsewhere</span>'}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="sec"><h2>Your ${S.year}-${String(S.year + 1).slice(2)} roster</h2><span class="n">${roster.length} players · development happens when the new season starts</span></div>
    <div class="sheet-wrap"><table class="sheet dense heat dy-sign"><thead><tr><th class="l">Player</th><th>Pos</th><th>Yr</th><th data-heat="1">OVR</th>${PILLARS.map(([k, l]) => `<th data-heat="1" title="${l}">${k}</th>`).join('')}</tr></thead><tbody>
      ${roster.map(p => `<tr><td class="l">${pl(p)}${p.fresh ? ' <span class="chip new">new</span>' : ''}</td><td>${esc(p.pos || '')}</td><td>${p.fresh ? 'Fr' : YR_LABEL[Math.min(5, p.yr + 1)]}</td><td><b>${ovrOf(p)}</b></td>${PILLARS.map(([k]) => `<td>${p.pillars[k]}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div>
    <div class="dy-btns"><button class="btn" id="oNext">Start the ${S.year}-${String(S.year + 1).slice(2)} season →</button></div>`;
  $('#dyBody').innerHTML = html;
  $('#oNext').onclick = () => run(() => { startNextSeason(S); tab = 'roster'; });
}

function jobPanel() {
  const J = S.job; if (!J) return '';
  const L = J.log && J.log.at(-1);
  const verdict = L ? (L.perf > 1 ? 'Well above expectations' : L.perf > 0.2 ? 'Above expectations' : L.perf > -0.2 ? 'Met expectations' : L.perf > -1 ? 'Below expectations' : 'Well below expectations') : '';
  const offers = (J.offers || []).filter(t => S.teams[t]);
  return `<div class="dy-next dy-job${J.fired ? ' fired' : ''}"><div class="lbl">${J.fired ? 'You have been fired' : 'Your job'}</div>
    <div class="ln">${L ? `${verdict}: the preseason roster rating had you #${L.pre}, you finished #${L.fin}. ` : ''}Job security <b>${J.security}</b>/100.</div>
    ${offers.length ? `<div class="ln" style="margin-top:8px">${J.fired ? 'These programs will hire you — pick one to continue:' : 'Job offers:'}</div>
      <div class="dy-btns">${offers.map(t => `<button class="btn ${J.fired ? '' : 'ghost'}" data-take="${esc(t)}">${tm(t)} <span class="dim">prestige ${S.teams[t].prestige}</span></button>`).join('')}</div>` : ''}</div>`;
}

function history() {
  const H = S.history;
  $('#dyBody').innerHTML = `<div class="sec"><h2>Program history</h2></div>${H.length ? `<div class="sheet-wrap"><table class="sheet dense dy-hist"><thead><tr><th class="l">Season</th><th class="l">Program</th><th>Record</th><th>Conf</th><th>Final power</th><th class="l">March</th><th class="l">Champion</th><th class="l">National POY</th></tr></thead><tbody>
    ${H.slice().reverse().map(h => `<tr><td class="l">${h.year - 1}-${String(h.year).slice(2)}</td><td class="l">${tm(h.user.team)}</td><td>${h.user.w}-${h.user.l}</td><td>${h.user.cw}-${h.user.cl}</td><td>#${h.user.rank}</td><td class="l">${esc(h.user.post)}</td><td class="l">${tm(h.champ)}</td><td class="l">${h.awards && h.awards.poy ? esc(h.awards.poy.name) : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="dy-empty">Finish a season to start your program\'s history.</div>'}`;
}

// boot
startScreen().catch(e => { $('#dyBody').innerHTML = `<div class="dy-empty">Couldn't load the dynasty: ${esc(e.message || e)}</div>`; });
