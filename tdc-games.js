/* ============================================================
   TDC GAMES · the shared engine every game uses (Sept 2026).
   - Daily puzzle: the same puzzle for everyone on the same Eastern-time date, one attempt a day.
     Pick it with TDCGames.seeded(gameId) (a deterministic random function for today) or
     TDCGames.pick(gameId, list, n) — NEVER Math.random — and draw from a pool that is loaded in a
     stable order (an ORDER BY on the query), so every visitor gets the same puzzle.
   - Saved stats per game on this device: played, wins, win streak, best streak, average and best
     score, daily streak. TDCGames.record(gameId, result) after every finished game.
   - Share: TDCGames.share(text) (native share sheet on phones, clipboard elsewhere).
   - UI helpers: modeBar (Daily / Practice), statsHtml, resultHtml.
   Stored in localStorage "tdc_games_v1": { gameId: { played, wins, streak, best, scoreSum, scored,
   bestScore, dstreak, dbest, lastDaily, daily: { 'YYYY-MM-DD': { score, win, share, detail } } } }
============================================================ */
window.TDCGames = (function () {
  var KEY = 'tdc_games_v1', EPOCH = '2026-09-01', SITE = 'thedepthchartcbb.com';
  var NAMES = {
    guess: 'Guess the Player', college: 'Guess the College', higher: 'Higher or Lower', statline: 'Stat Line Guess',
    rank: "Rank 'Em", career: 'Career Path', grade: 'Grade Guess', grid: 'Hoop Grid'
  };
  var PAGES = {
    guess: 'game-guess.html', college: 'game-college.html', higher: 'game-higher.html', statline: 'game-statline.html',
    rank: 'game-rank.html', career: 'game-career.html', grade: 'game-grade.html', grid: 'game-grid.html'
  };

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }

  // the puzzle date is Eastern time, so everyone rolls over together at midnight ET
  function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()); }
  function shiftDay(d, n) { var t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
  function dayNumber(d) { return Math.round((new Date((d || today()) + 'T12:00:00Z') - new Date(EPOCH + 'T12:00:00Z')) / 864e5) + 1; }

  // deterministic randomness: FNV-1a hash of "game|date" seeds mulberry32
  function hash(str) { var h = 2166136261 >>> 0; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
  function rng(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function seeded(gameId, date) { return rng(hash(gameId + '|' + (date || today()))); }
  // n distinct items from list for today's puzzle (list must be in a stable order)
  function pick(gameId, list, n, date) {
    var r = seeded(gameId, date), a = list.slice(), out = [];
    for (var i = 0; i < Math.min(n || 1, a.length); i++) { var j = i + Math.floor(r() * (a.length - i)); var t = a[i]; a[i] = a[j]; a[j] = t; out.push(a[i]); }
    return n ? out : out[0];
  }

  function game(all, id) {
    return all[id] || (all[id] = { played: 0, wins: 0, streak: 0, best: 0, scoreSum: 0, scored: 0, bestScore: null, dstreak: 0, dbest: 0, lastDaily: null, daily: {} });
  }
  function stats(id) { return game(load(), id); }
  function dailyResult(id) { var g = stats(id); return (g.daily && g.daily[today()]) || null; }

  // result: { daily: bool, win: bool, score: number (optional), share: text (optional), detail: any (optional) }
  function record(id, r) {
    var all = load(), g = game(all, id), d = today();
    if (r.daily && g.daily[d]) return g;                      // one daily attempt counts
    g.played++;
    if (r.win) { g.wins++; g.streak++; g.best = Math.max(g.best, g.streak); } else g.streak = 0;
    if (r.score != null && isFinite(r.score)) { g.scoreSum += +r.score; g.scored++; g.bestScore = g.bestScore == null ? +r.score : Math.max(g.bestScore, +r.score); }
    if (r.daily) {
      g.daily[d] = { score: r.score != null ? r.score : null, win: !!r.win, share: r.share || '', detail: r.detail || null };
      g.dstreak = (g.lastDaily === shiftDay(d, -1)) ? g.dstreak + 1 : 1;
      g.dbest = Math.max(g.dbest, g.dstreak); g.lastDaily = d;
      var keys = Object.keys(g.daily).sort(); while (keys.length > 60) delete g.daily[keys.shift()];
    }
    save(all); return g;
  }
  // a daily streak only counts if yesterday's (or today's) daily was played
  function liveDailyStreak(g) { var d = today(); return (g.lastDaily === d || g.lastDaily === shiftDay(d, -1)) ? g.dstreak : 0; }

  function toast(msg) {
    var t = document.createElement('div'); t.className = 'gm-toast'; t.textContent = msg; document.body.appendChild(t);
    setTimeout(function () { t.classList.add('out'); }, 1600); setTimeout(function () { t.remove(); }, 2100);
  }
  function share(text) {
    var touch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    if (touch && navigator.share) { navigator.share({ text: text }).catch(function () {}); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(function () { toast('Copied. Paste it anywhere.'); }, function () { window.prompt('Copy your result:', text); }); }
    else window.prompt('Copy your result:', text);
  }
  // standard share header: "The Depth Chart · Higher or Lower #27"
  function shareHead(id, daily) { return 'The Depth Chart · ' + (NAMES[id] || id) + (daily ? ' #' + dayNumber() : ''); }
  function shareText(id, daily, lines) { return [shareHead(id, daily)].concat(lines || []).concat([SITE + '/' + (PAGES[id] || 'games.html')]).join('\n'); }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // stats panel: opts.score = label for the average score (omit to hide), opts.win = label for wins
  function statsHtml(id, opts) {
    opts = opts || {}; var g = stats(id);
    var cells = [['Played', g.played], [opts.win || 'Win %', g.played ? Math.round(g.wins / g.played * 100) + '%' : '—'],
      ['Streak', g.streak], ['Best streak', g.best]];
    if (opts.score) cells.push([opts.score, g.scored ? (Math.round(g.scoreSum / g.scored * 10) / 10) : '—']);
    cells.push(['Daily streak', liveDailyStreak(g)]);
    return '<dl class="gm-stats">' + cells.map(function (c) { return '<div><dd>' + esc(c[1]) + '</dd><dt>' + esc(c[0]) + '</dt></div>'; }).join('') + '</dl>';
  }

  // Daily / Practice switch. onChange(mode) with 'daily' | 'practice'
  function modeBar(host, mode, onChange) {
    if (typeof host === 'string') host = document.getElementById(host);
    if (!host) return;
    host.className = 'gm-modes';
    host.innerHTML = '<button type="button" class="chip' + (mode === 'daily' ? ' on' : '') + '" data-mode="daily">Daily #' + dayNumber() + '</button>' +
      '<button type="button" class="chip' + (mode === 'practice' ? ' on' : '') + '" data-mode="practice">Practice</button>';
    host.onclick = function (e) { var b = e.target.closest('[data-mode]'); if (b && b.getAttribute('data-mode') !== mode) onChange(b.getAttribute('data-mode')); };
  }

  // the end-of-game block: headline, one line, Share button, stats. opts: {title, line, shareText, statsOpts, again}
  function resultHtml(id, opts) {
    return '<div class="gm-result"><div class="gm-result-h">' + esc(opts.title || 'Done') + '</div>' +
      (opts.line ? '<div class="gm-result-l">' + opts.line + '</div>' : '') +
      '<div class="gm-result-a">' + (opts.shareText ? '<button type="button" class="gm-btn" data-gm-share>Share result</button>' : '') +
      (opts.again ? '<button type="button" class="gm-btn ghost" data-gm-again>' + esc(opts.again) + '</button>' : '') + '</div>' +
      statsHtml(id, opts.statsOpts) + (opts.daily ? '<div class="gm-next">Next daily in <span data-gm-count></span></div>' : '') + '</div>';
  }
  // wire a rendered result block: share text + "again" callback + countdown to midnight ET
  function wireResult(root, text, again) {
    if (typeof root === 'string') root = document.getElementById(root);
    if (!root) return;
    var s = root.querySelector('[data-gm-share]'); if (s) s.onclick = function () { share(text); };
    var a = root.querySelector('[data-gm-again]'); if (a && again) a.onclick = again;
    var c = root.querySelector('[data-gm-count]');
    if (c) { var tick = function () { if (!document.body.contains(c)) return; c.textContent = untilMidnight(); setTimeout(tick, 30000); }; tick(); }
  }
  function untilMidnight() {
    var now = new Date(), et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    var mid = new Date(et); mid.setHours(24, 0, 0, 0); var m = Math.max(0, Math.round((mid - et) / 60000));
    return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  }

  return { NAMES: NAMES, PAGES: PAGES, today: today, dayNumber: dayNumber, seeded: seeded, pick: pick, hash: hash, rng: rng,
    stats: stats, dailyResult: dailyResult, record: record, liveDailyStreak: liveDailyStreak,
    share: share, shareText: shareText, toast: toast, statsHtml: statsHtml, modeBar: modeBar,
    resultHtml: resultHtml, wireResult: wireResult, untilMidnight: untilMidnight, esc: esc };
})();
