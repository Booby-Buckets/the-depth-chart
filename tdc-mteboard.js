/* tdc-mteboard.js — the early-season (MTE) bracket board on tournaments.html.
 *
 * A 4- or 8-team event drawn the way TV/event sites draw them: the consolation side on the left,
 * the quarterfinals in the middle, semifinals → championship / third place on the right. Every row
 * carries the neutral-site win probability; on a projected event any team can be clicked to LOCK
 * that result, and everything downstream re-pairs and re-prices (a lock that no longer fits its
 * game is ignored). Played games show the score instead. Tip times / networks come from ESPN's
 * scoreboard for the event's dates (matched by the event note), when ESPN has them.
 *
 *   TDCMteBoard.slots(games)  -> {size:4|8, qf:[game×4]|null, sf:[game×2], …} or null (not a clean event)
 *   TDCMteBoard.render(host, {key, name, games, prob(a,b), rank(full), short(full), logo(full), link(full),
 *                              dates:[iso…], venue, live:bool})
 */
(function (g) {
  'use strict';
  const RX = {
    qf: /quarter/i, cs: /consolation\s*semi/i, sf: /^semi/i, ch: /champ/i,
    tp: /third|3rd/i, f5: /fifth|5th/i, s7: /seventh|7th/i,
  };
  const winnerOf = gm => gm && gm.winner ? gm.winner : null;
  const loserOf = gm => gm && gm.winner ? (gm.winner === gm.home ? gm.away : gm.home) : null;
  const has = (gm, t) => gm && (gm.home === t || gm.away === t);

  // Identify each slot of a clean 4/8-team event from its games (round names + who won what).
  function slots(games, noFallback) {
    const by = k => games.filter(x => RX[k].test(x.round || '') && !(k === 'sf' && RX.cs.test(x.round || '')));
    const qf = by('qf'), sf = by('sf'), cs = by('cs'), ch = by('ch'), tp = by('tp'), f5 = by('f5'), s7 = by('s7');
    if (ch.length !== 1 || sf.length !== 2) return noFallback ? null : structural(games);
    if (qf.length === 0 && games.length <= 4) {
      return { size: 4, sf: sf.slice(), ch: ch[0], tp: tp[0] || null };
    }
    if (qf.length !== 4) return noFallback ? null : structural(games);
    // order the quarterfinals so QF0/QF1 feed SF0 and QF2/QF3 feed SF1 (by who won through)
    const feeds = s => qf.filter(q => winnerOf(q) && has(s, winnerOf(q)));
    const a = feeds(sf[0]), b = feeds(sf[1]);
    const order = (a.length === 2 && b.length === 2) ? a.concat(b) : qf.slice().sort((x, y) => (x.id < y.id ? -1 : 1));
    // consolation semis: the one holding QF0/QF1's losers is CS0
    const csOrd = cs.length === 2
      ? (cs[0] && (has(cs[0], loserOf(order[0])) || has(cs[0], loserOf(order[1]))) ? cs : cs.slice().reverse())
      : cs;
    return { size: 8, qf: order, sf: sf.slice(), cs: csOrd, ch: ch[0], tp: tp[0] || null, f5: f5[0] || null, s7: s7[0] || null };
  }

  // Past events name rounds every which way ("Round 1", "Round 2", "3rd Place"), so read the shape
  // from the results instead: a game's round = how many earlier games its teams had played in the
  // event; day-2 / day-3 games are told apart by who won what before.
  function structural(games) {
    const n = games.length;
    if (!(n === 12 || n === 4) || games.some(x => !x.winner)) return null;
    const seen = {}, rounds = [[], [], []];
    games.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id < b.id ? -1 : 1))).forEach(x => {
      const r = Math.max(seen[x.home] || 0, seen[x.away] || 0);
      if (r > 2) return; rounds[r].push(x); seen[x.home] = r + 1; seen[x.away] = r + 1;
    });
    const won = (list, t) => list.some(x => x.winner === t);
    const both = (list, f) => list.filter(x => f(x.home) && f(x.away));
    if (n === 4) {
      if (rounds[0].length !== 2 || rounds[1].length !== 2) return null;
      const ch = both(rounds[1], t => won(rounds[0], t)), tp = both(rounds[1], t => !won(rounds[0], t));
      return ch.length === 1 ? { size: 4, sf: rounds[0], ch: ch[0], tp: tp[0] || null } : null;
    }
    if (rounds.some(r => r.length !== 4)) return null;
    const sf = both(rounds[1], t => won(rounds[0], t)), cs = both(rounds[1], t => !won(rounds[0], t));
    if (sf.length !== 2 || cs.length !== 2) return null;
    const pick = f => both(rounds[2], f)[0] || null;
    const ch = pick(t => won(sf, t)), tp = pick(t => has(sf[0], t) || has(sf[1], t) ? !won(sf, t) : false);
    const f5 = pick(t => won(cs, t)), s7 = pick(t => has(cs[0], t) || has(cs[1], t) ? !won(cs, t) : false);
    if (!ch) return null;
    const relabel = (x, r) => Object.assign({}, x, { round: r });
    return slots([].concat(rounds[0].map(x => relabel(x, 'Quarterfinal')), sf.map(x => relabel(x, 'Semifinal')), cs.map(x => relabel(x, 'Consolation Semifinal')),
      [relabel(ch, 'Championship')], tp ? [relabel(tp, 'Third Place')] : [], f5 ? [relabel(f5, 'Fifth Place')] : [], s7 ? [relabel(s7, 'Seventh Place')] : []), true);
  }

  // ── lock store (per event, per viewer) ──
  const LKEY = k => 'tdc_mte_locks:' + k;
  const loadLocks = k => { try { return JSON.parse(localStorage.getItem(LKEY(k)) || '{}') || {}; } catch (e) { return {}; } };
  const saveLocks = (k, L) => { try { localStorage.setItem(LKEY(k), JSON.stringify(L)); } catch (e) {} };

  // ── ESPN tip times / networks for the event (best effort) ──
  const _sbCache = {};
  function scoreboard(day) {
    if (!_sbCache[day]) {
      _sbCache[day] = fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=' +
        day.replace(/-/g, '') + '&groups=50&limit=400').then(r => (r.ok ? r.json() : null)).catch(() => null);
    }
    return _sbCache[day];
  }
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  async function tvFor(name, dates) {
    const want = norm(name.replace(/\(projected\)/i, '')).replace(/^the /, '');
    const out = [];
    for (const day of dates || []) {
      const sb = await scoreboard(day);
      ((sb && sb.events) || []).forEach(e => {
        const c = (e.competitions || [])[0] || {};
        const note = ((c.notes || [])[0] || {}).headline || '';
        if (!note || norm(note).indexOf(want) < 0) return;
        const teams = (c.competitors || []).map(t => (t.team && t.team.displayName) || '');
        const net = (c.broadcasts || []).map(b => (b.names || []).join('/')).filter(Boolean).join('/');
        out.push({ day, at: e.date, teams, net, tag: note.split(' - ')[1] || '' });
      });
    }
    return out;
  }
  const tClock = iso => {
    try { return new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).replace(':00', '').replace(' ', ' '); }
    catch (e) { return ''; }
  };
  const dayLong = iso => { const d = new Date(iso + 'T12:00:00'); return isNaN(d) ? '' : d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); };

  // ── model ──
  function compute(S, ctx, L) {
    const G = {};                         // slot -> {a,b,p,w,l,locked,real}
    const play = (key, a, b, real) => {
      if (!a || !b) { G[key] = { a, b, p: null, w: null, l: null }; return G[key]; }
      const p = ctx.prob(a, b);
      let w = null, locked = false, played = false;
      if (real && real.winner && (real.home_score != null || !real._proj) && has(real, a) && has(real, b)) { w = real.winner; played = true; }
      else if (L[key] === a || L[key] === b) { w = L[key]; locked = true; }
      else w = p >= 0.5 ? a : b;
      const sc = played && real.home_score != null ? { [real.home]: real.home_score, [real.away]: real.away_score } : null;
      G[key] = { a, b, p, w, l: w === a ? b : a, locked, played, sc, real };
      return G[key];
    };
    const pr = gm => [gm.home, gm.away];
    if (S.size === 8) {
      S.qf.forEach((q, i) => { const [a, b] = pr(q); play('qf' + i, a, b, q); });
      play('sf0', G.qf0.w, G.qf1.w, S.sf[0]); play('sf1', G.qf2.w, G.qf3.w, S.sf[1]);
      play('cs0', G.qf0.l, G.qf1.l, S.cs && S.cs[0]); play('cs1', G.qf2.l, G.qf3.l, S.cs && S.cs[1]);
      play('ch', G.sf0.w, G.sf1.w, S.ch); play('tp', G.sf0.l, G.sf1.l, S.tp);
      play('f5', G.cs0.w, G.cs1.w, S.f5); play('s7', G.cs0.l, G.cs1.l, S.s7);
    } else {
      S.sf.forEach((s, i) => { const [a, b] = pr(s); play('sf' + i, a, b, s); });
      play('ch', G.sf0.w, G.sf1.w, S.ch); play('tp', G.sf0.l, G.sf1.l, S.tp);
    }
    return G;
  }
  // exact title odds (winners' side only), respecting locks / played games
  function titleOdds(S, G, ctx) {
    const dist = key => {
      const x = G[key];
      if (!x || !x.a || !x.b) return {};
      if (x.played || x.locked) return { [x.w]: 1 };
      return null;                                     // caller combines feeders
    };
    const combine = (key, A, B) => {
      const fixed = dist(key); if (fixed) return fixed;
      const out = {};
      Object.entries(A).forEach(([a, pa]) => Object.entries(B).forEach(([b, pb]) => {
        const p = ctx.prob(a, b); out[a] = (out[a] || 0) + pa * pb * p; out[b] = (out[b] || 0) + pa * pb * (1 - p);
      }));
      return out;
    };
    const leaf = (key, gm) => { const f = dist(key); if (f) return f; const x = G[key]; return { [x.a]: x.p, [x.b]: 1 - x.p }; };
    let s0, s1;
    if (S.size === 8) {
      s0 = combine('sf0', leaf('qf0'), leaf('qf1')); s1 = combine('sf1', leaf('qf2'), leaf('qf3'));
    } else { s0 = leaf('sf0'); s1 = leaf('sf1'); }
    return combine('ch', s0, s1);
  }

  // ── render ──
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const typ = k => (k === 'f5' || k === 's7') ? k : k.replace(/\d$/, '');
  const TAG = { ch: /champ/i, tp: /third|3rd|consolation$/i, f5: /fifth|5th/i, s7: /seventh|7th/i };
  const LABEL = { qf: 'Quarterfinal', sf: 'Semifinal', cs: 'Consolation semifinal', ch: 'Championship', tp: 'Third place', f5: 'Fifth place', s7: 'Seventh place' };

  function render(host, ctx) {
    const S = ctx.S || slots(ctx.games);
    if (!S) return false;
    const L = ctx.live ? loadLocks(ctx.key) : {};
    host.innerHTML = '<div class="mtb"><div class="mtb-head"><div><div class="mtb-ttl">' + (ctx.title ? esc(ctx.title) + ' · ' : '') + (ctx.live ? 'Predicted bracket' : 'Bracket') + '</div>' +
      '<div class="mtb-sub">' + (ctx.live ? 'Neutral-site win probabilities · locked results carry forward automatically' : 'Final results from the played games') + '</div></div>' +
      '<div class="mtb-hint">' + (ctx.live ? 'Model probabilities active · click any team to lock a result' : '') + '</div></div>' +
      '<div class="mtb-scroll"><div class="mtb-board"></div></div><div class="mtb-foot"></div></div>';
    const board = host.querySelector('.mtb-board'), foot = host.querySelector('.mtb-foot');
    let TV = [];
    const dateOf = k => {
      const real = k.startsWith('qf') ? S.qf[+k.slice(2)] : k.startsWith('sf') ? S.sf[+k.slice(2)] : k.startsWith('cs') ? S.cs && S.cs[+k.slice(2)] : S[k];
      return real ? real.date : null;
    };
    const tvLine = (k, G) => {
      const x = G[k], day = dateOf(k);
      if (!TV.length || !day) return esc(ctx.venue || '');
      const pair = [norm(x.a), norm(x.b)].sort().join('|');
      const exact = x.a && x.b && TV.find(e => e.teams.map(norm).sort().join('|') === pair);
      const slot = typ(k);
      const tagged = TV.find(e => e.day === day && e.tag && TAG[slot] && TAG[slot].test(e.tag));
      const hit = exact || tagged;
      if (hit) return esc(tClock(hit.at) + ' ET' + (hit.net ? ' · ' + hit.net : ''));
      const sameDay = TV.filter(e => e.day === day && !e.teams.some(t => t && t !== 'TBD' && !/^tbd/i.test(t)) && !e.tag);
      if (sameDay.length > 1) {
        const times = sameDay.map(e => tClock(e.at).replace(/ (AM|PM)$/, '')), nets = [...new Set(sameDay.map(e => e.net).filter(Boolean))];
        // a long list of candidate tips is unreadable in a card — show the day's window instead
        if (times.length > 4) {
          const at = sameDay.map(e => e.at).sort();
          return '<span title="' + esc(times.join(', ') + ' ET') + '">' + esc('TBA · ' + (tClock(at[0]) + '–' + tClock(at[at.length - 1])).replace(/ (AM|PM)(?=–.* \1$)/, '') + ' ET') + '</span>';
        }
        return esc(times.slice(0, -1).join(', ') + ' or ' + times[times.length - 1] + ' ET' + (nets.length && nets.length <= 2 ? ' · ' + nets.join(' / ') : ''));
      }
      return esc(ctx.venue || '');
    };
    const row = (k, x, t) => {
      if (!t) return '<div class="mtb-r mtb-tbd"><span class="mtb-lg"></span><span class="mtb-nm">TBD</span><span class="mtb-p"></span></div>';
      const win = x.w === t, p = x.p == null ? null : (t === x.a ? x.p : 1 - x.p);
      const rk = ctx.rank(t), lg = ctx.logo(t);
      const right = x.sc ? '<b>' + x.sc[t] + '</b>' : (p == null ? '' : Math.round(p * 100) + '%');
      return '<div class="mtb-r' + (win ? ' w' : '') + (x.locked && win ? ' lk' : '') + (ctx.live && !x.played ? ' can' : '') + '" data-k="' + k + '" data-t="' + esc(t) + '"' +
        (ctx.live && !x.played ? ' title="' + (x.locked && win ? 'Locked — click to unlock' : 'Click to lock ' + esc(ctx.short(t)) + ' winning') + '"' : '') + '>' +
        '<span class="mtb-lg">' + (lg ? '<img src="' + lg + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '') + '</span>' +
        (rk ? '<span class="mtb-rk">#' + rk + '</span>' : '') +
        (ctx.live && !x.played ? '<span class="mtb-nm">' + esc(ctx.short(t)) + '</span>'          // the row is the lock button
          : '<a class="mtb-nm" href="' + ctx.link(t) + '" onclick="event.stopPropagation()">' + esc(ctx.short(t)) + '</a>') +
        (x.locked && win ? '<span class="mtb-lock" aria-label="locked">●</span>' : '') +
        '<span class="mtb-p">' + right + '</span></div>';
    };
    const card = (k, G) => {
      const x = G[k];
      return '<div class="mtb-card" data-slot="' + k + '"><div class="mtb-ch"><div class="mtb-rd">' + LABEL[typ(k)] + '</div>' +
        '<div class="mtb-tv">' + tvLine(k, G) + '</div></div>' + row(k, x, x.a) + row(k, x, x.b) + '</div>';
    };
    const col = (title, keys, G, cls) => {
      const day = dateOf(Array.isArray(keys[0]) ? keys[0][0] : keys[0]);
      const zones = keys.map(z => '<div class="mtb-zone">' + (Array.isArray(z) ? z : [z]).map(k => card(k, G)).join('') + '</div>').join('');
      return '<div class="mtb-col ' + (cls || '') + '"><div class="mtb-colh"><div class="mtb-day">' + (day ? dayLong(day) : '') + '</div><div class="mtb-coltt">' + title + '</div></div>' +
        '<div class="mtb-zones">' + zones + '</div></div>';
    };

    function draw() {
      const G = compute(S, ctx, L);
      const cols = S.size === 8
        ? [col('Fifth / Seventh place', ['f5', 's7'], G, 'c-place'), col('Consolation semifinals', ['cs0', 'cs1'], G, 'c-cons'),
           col('Quarterfinals', [['qf0', 'qf1'], ['qf2', 'qf3']], G, 'c-qf'), col('Semifinals', ['sf0', 'sf1'], G, 'c-sf'),
           col('Championship / Third place', ['ch', 'tp'], G, 'c-final')]
        : [col('Semifinals', ['sf0', 'sf1'], G, 'c-sf'), col('Championship / Third place', ['ch', 'tp'], G, 'c-final')];
      board.className = 'mtb-board n' + cols.length;
      board.innerHTML = '<svg class="mtb-lines" aria-hidden="true"></svg>' + cols.join('');
      // footer: the scenario's champion + exact title odds for the field as it stands
      const odds = titleOdds(S, G, ctx), champ = G.ch.w, nLocks = Object.keys(L).length;
      const list = Object.entries(odds).sort((a, b) => b[1] - a[1]);
      const fp = G.ch.p == null ? null : (champ === G.ch.a ? G.ch.p : 1 - G.ch.p);
      foot.innerHTML = '<div class="mtb-out"><div class="mtb-outl"><div class="mtb-kick">' + (ctx.live ? (nLocks ? 'Your scenario' : 'Scenario outcome') : 'Champion') + '</div>' +
        '<div class="mtb-champ">' + (champ ? (ctx.logo(champ) ? '<img src="' + ctx.logo(champ) + '" alt="">' : '') + esc(ctx.short(champ)) : 'TBD') + '</div>' +
        '<div class="mtb-why">' + (ctx.live ? (nLocks ? nLocks + ' locked result' + (nLocks > 1 ? 's' : '') + ' · <button type="button" class="mtb-reset">Reset to model</button>' : 'Current model path through the bracket.') : 'Final standings from the played games.') + '</div></div>' +
        (fp != null && !G.ch.played ? '<div class="mtb-outr"><div class="mtb-big">' + Math.round(fp * 100) + '%</div><div class="mtb-lbl">final matchup probability</div></div>' : '') + '</div>' +
        (ctx.live && list.length ? '<div class="mtb-odds"><div class="mtb-kick">Title odds' + (nLocks ? ' with your locks' : '') + '</div><div class="mtb-oddsr">' +
          list.map(([t, p]) => '<span class="mtb-odd"><span class="mtb-lg">' + (ctx.logo(t) ? '<img src="' + ctx.logo(t) + '" alt="">' : '') + '</span>' + esc(ctx.short(t)) +
            '<b>' + (p >= 0.995 ? '100' : p < 0.005 ? '<1' : Math.round(p * 100)) + '%</b><i style="width:' + Math.max(2, p * 100) + '%"></i></span>').join('') + '</div></div>' : '');
      requestAnimationFrame(lines);
    }
    // connector elbows between rounds (desktop only; hidden when the columns stack)
    function lines() {
      const svg = board.querySelector('.mtb-lines'); if (!svg) return;
      const R = board.getBoundingClientRect();
      svg.setAttribute('width', R.width); svg.setAttribute('height', R.height);
      const box = k => { const el = board.querySelector('[data-slot="' + k + '"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left - R.left, r: r.right - R.left, m: r.top - R.top + r.height / 2 }; };
      const pairs = S.size === 8
        ? [['qf0', 'qf1', 'sf0', 1], ['qf2', 'qf3', 'sf1', 1], ['qf0', 'qf1', 'cs0', -1], ['qf2', 'qf3', 'cs1', -1], ['sf0', 'sf1', 'ch', 1], ['cs0', 'cs1', 'f5', -1]]
        : [['sf0', 'sf1', 'ch', 1]];
      let d = '';
      pairs.forEach(([a, b, to, dir]) => {
        const A = box(a), B = box(b), T = box(to); if (!A || !B || !T) return;
        const xs = dir > 0 ? A.r : A.l, xt = dir > 0 ? T.l : T.r, mx = (xs + xt) / 2;
        d += 'M' + xs + ' ' + A.m + 'H' + mx + 'V' + B.m + 'H' + xs + 'M' + mx + ' ' + T.m + 'H' + xt;
      });
      svg.innerHTML = '<path d="' + d + '" fill="none"/>';
    }
    board.addEventListener('click', e => {
      if (!ctx.live) return;
      const r = e.target.closest('.mtb-r.can'); if (!r) return;
      const k = r.dataset.k, t = r.dataset.t;
      if (L[k] === t) delete L[k]; else L[k] = t;
      saveLocks(ctx.key, L); draw();
    });
    foot.addEventListener('click', e => {
      if (!e.target.closest('.mtb-reset')) return;
      Object.keys(L).forEach(k => delete L[k]); saveLocks(ctx.key, L); draw();
    });
    // redraw the elbows whenever the board's box changes (viewport, fonts/logos landing, zoom)
    if (g.ResizeObserver) new ResizeObserver(() => requestAnimationFrame(lines)).observe(board);
    else window.addEventListener('resize', () => requestAnimationFrame(lines));
    draw();
    if (ctx.dates && ctx.dates.length) tvFor(ctx.name, ctx.dates).then(tv => { if (tv && tv.length) { TV = tv; draw(); } });
    return true;
  }

  // Events that aren't a bracket (pods with set matchups, round robins, a cross-bracket final):
  // the same cards, one column per day, model favourite (or the real winner) in green.
  function renderList(host, ctx) {
    const days = [...new Set(ctx.games.map(x => x.date).filter(Boolean))].sort();
    if (!days.length) return false;
    const row = (gm, t) => {
      const real = gm.home_score != null && gm.winner, a = gm.home, p = ctx.prob(a, gm.away), pt = t === a ? p : 1 - p;
      const win = real ? gm.winner === t : (p >= 0.5 ? a : gm.away) === t, rk = ctx.rank(t), lg = ctx.logo(t);
      const right = real ? '<b>' + (t === gm.home ? gm.home_score : gm.away_score) + '</b>' : Math.round(pt * 100) + '%';
      return '<div class="mtb-r' + (win ? ' w' : '') + '"><span class="mtb-lg">' + (lg ? '<img src="' + lg + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '') + '</span>' +
        (rk ? '<span class="mtb-rk">#' + rk + '</span>' : '') + '<a class="mtb-nm" href="' + ctx.link(t) + '">' + esc(ctx.short(t)) + '</a><span class="mtb-p">' + right + '</span></div>';
    };
    const card = gm => '<div class="mtb-card"><div class="mtb-ch"><div class="mtb-rd">' + esc(gm.round || 'Game') + '</div><div class="mtb-tv">' + esc(ctx.venue || '') + '</div></div>' +
      row(gm, gm.home) + row(gm, gm.away) + '</div>';
    host.innerHTML = '<div class="mtb"><div class="mtb-head"><div><div class="mtb-ttl">' + (ctx.title ? esc(ctx.title) + ' · ' : '') + (ctx.live ? 'Predicted games' : 'Games') + '</div>' +
      '<div class="mtb-sub">' + (ctx.live ? 'Neutral-site win probabilities · set matchups, no bracket' : 'Final results') + '</div></div></div>' +
      '<div class="mtb-scroll"><div class="mtb-days" style="--n:' + days.length + '">' + days.map(d =>
        '<div class="mtb-col"><div class="mtb-colh"><div class="mtb-day">' + dayLong(d) + '</div><div class="mtb-coltt">' + (days.length > 1 ? 'Day ' + (days.indexOf(d) + 1) : 'Games') + '</div></div>' +
        '<div class="mtb-stack">' + ctx.games.filter(x => x.date === d).map(card).join('') + '</div></div>').join('') + '</div></div></div>';
    return true;
  }

  g.TDCMteBoard = { slots, render, renderList };
})(window);
