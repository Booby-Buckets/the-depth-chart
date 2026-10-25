/* bet-edge.js — TDC Bet's edge finder: every market a sportsbook posts, priced by our model, ranked by
 * expected value at the best available price.
 *
 *   TDCEdge.load()        → Promise   book odds (odds_live.json), the prop model, player names, in-season form
 *   TDCEdge.has()         → bool      the feed has book prices right now
 *   TDCEdge.game(row)     → {markets}  every priced outcome for one game (row = TDCBet.slate/game row)
 *   TDCEdge.board(rows)   → [bet]      the best side per market per game, sorted by EV, with Kelly stakes
 *   TDCEdge.props(rows)   → [bet]      every posted player prop, priced
 *   TDCEdge.books()       → [{key, title, n, kind}]   places to bet seen in the feed (for "my books"; no Pinnacle)
 *   TDCEdge.raw()         → [game]   the merged feed games as-is (bet-arb.js scans these)
 *   TDCEdge.dfs(rows)     → Promise<[line]>  every DFS pick'em line (PrizePicks, Underdog …), our chance of More/Less
 *
 * HOW A PRICE BECOMES A BET
 *   our chance   spread/total/ML from TDC_RATINGS.lineFor + tempo x efficiency; props from the negative-binomial
 *                prop model (scripts/fit_prop_model.py → prop_model.json) on our projected line
 *   market       the consensus of every book's no-vig price. When Pinnacle (the sharpest book; feed kind "sharp")
 *                hangs the market its no-vig number carries SHARP_W of it — a reference line, never a place to bet
 *   platforms    book = US sportsbooks · ex = exchanges (prices arrive with fees taken out) · sharp = Pinnacle ·
 *                DFS pick'em lines ride apart in game.dfs (fixed payouts, no odds) and are priced by dfs()
 *   blend        p = w·ours + (1 − w)·market. Books are sharp; a model that ignores them finds "edges" on
 *                every game. w per market type (W below) is deliberately modest until the historical-odds
 *                backtest tunes it — the blend is what keeps the board honest.
 *   EV           p × decimal price − 1, at each book; the bet is shown at the best one
 *   stake        quarter Kelly, capped at 2% of bankroll
 * Needs bet-core.js (TDCBet) and tdc-ratings.js.
 */
(function (g) {
  'use strict';
  var B = g.TDCBet;
  var W = { spread: 0.30, total: 0.25, ml: 0.30, tt: 0.30, h1: 0.20, alt: 0.25, prop: 0.35 };
  // the bar a bet has to clear (EV per $1) before it's listed: conservative until the backtest tunes it
  var MIN_EV = { spread: 0.03, total: 0.03, ml: 0.035, tt: 0.04, h1: 0.04, alt: 0.05, prop: 0.05 };
  var SD = { team: 9.5, h1m: 7.6, h1t: 10.5 };         // team-score sd; first-half margin / total sd
  var H1 = { m: 0.47, t: 0.475 };                       // first half share of the full-game margin / total
  var SHARP_W = 0.6;                                    // Pinnacle's weight in the market reference when it's posted
  var EXCH = { kalshi: 1, polymarket: 1, novig: 1, prophetx: 1, betopenly: 1, sporttrade: 1 };
  var E = { odds: null, model: null, names: null, form: null, ready: null, fixture: false };

  function getJ(u, o) { return fetch(u, o).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  function isLocal() { return /^(localhost|127\.0\.0\.1)$/.test(location.hostname); }

  function load() {
    if (E.ready) return E.ready;
    // local development: ?fixture=1 reads a generated sample board (scripts/make_odds_fixture.py, git-ignored)
    var fx = isLocal() && /[?&]fixture=1/.test(location.search);
    E.fixture = fx;
    return (E.ready = Promise.all([
      fx ? null : getJ('scripts/data/odds_live.json', { cache: 'no-cache' }),
      getJ('scripts/data/prop_model.json?v=1'),
      getJ('scripts/data/prop_form_2027.json?h=' + new Date().toISOString().slice(0, 13), { cache: 'no-cache' }),
      B.load()
    ]).then(function (r) { E.model = r[1]; E.form = (r[2] && r[2].players) || {}; return fx ? B.loadProps().then(fixture) : r[0]; })
      .then(function (odds) { E.odds = odds; index(); return E; }));
  }
  // LOCAL DEV ONLY (?fixture=1 on localhost): a fake book board built around our own numbers with seeded noise,
  // so the edge board can be exercised before real books post. Never used on the live site.
  function fixture() {
    var S = B.state(), seed = 7, rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    var nrm = function () { return Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd()); };
    var day = S.dates.find(function (d) { return d >= B.isoDay() && B.slate(d).some(function (r) { return !r.exh; }); });
    var BK = [['draftkings', 'DraftKings'], ['fanduel', 'FanDuel'], ['betmgm', 'BetMGM'], ['caesars', 'Caesars'], ['espnbet', 'ESPN BET'], ['fanatics', 'Fanatics']];
    var am = function (p) { return p >= 0.5 ? -Math.round(100 * p / (1 - p)) : Math.round(100 * (1 - p) / p); };
    var two = function (p) { var v = 0.024; return [am(Math.min(0.97, p + v)), am(Math.min(0.97, 1 - p + v))]; };
    var games = [];
    [day].concat(S.dates.filter(function (d) { return d > day; }).slice(0, 12)).forEach(function (d) {
      B.slate(d).filter(function (r) { return !r.exh; }).slice(0, 40).forEach(function (r) {
        var mm = r.m + nrm() * 2.2, tm = (r.tot || 145) + nrm() * 3.5, books = {};
        BK.forEach(function (b) {
          var sp = -Math.round((mm + (rnd() < 0.25 ? nrm() * 0.7 : 0)) * 2) / 2, to = Math.round((tm + (rnd() < 0.25 ? nrm() * 0.9 : 0)) * 2) / 2, ph = B.phi(mm / 11);
          var j = rnd() < 0.3 ? 5 : 0, ml = two(ph);
          books[b[0]] = { t: b[1], sp: [sp, -110 - j, -110 + j], to: [to, -110 + j, -110 - j], ml: ml };
        });
        var spP = -Math.round(mm * 2) / 2, toP = Math.round(tm * 2) / 2;
        books.pinnacle = { t: 'Pinnacle', k: 'sharp', sp: [spP, -104, -106], to: [toP, -105, -105], ml: two(B.phi(mm / 11)).map(function (o) { return o + 8; }) };   // thinner vig, like the real thing
        books.novig = { t: 'Novig', k: 'ex', sp: [spP, -102, -103], to: [toP, -101, -104] };
        var props = [], dfs = [];
        Object.keys(S.PR || {}).forEach(function (pid) {
          var pr = S.PR[pid]; if (!pr || (pr.team !== r.home && pr.team !== r.away) || !(pr.mpg >= 24)) return;
          var nm = (S.P.find(function (p) { return p.id === pid; }) || {}).name; if (!nm) return;
          ['pts', 'reb', 'ast', 'tpm', 'pra'].forEach(function (st) {
            var pm = propMean(pid, st, r, pr.team === r.home); if (!pm || pm.mu < 1.2) return;
            var mk = pm.mu * (1 + nrm() * 0.1), base = Math.max(0.5, Math.round(mk - 0.5) + 0.5), b = {};
            BK.slice(0, 4).forEach(function (bk) { var line = rnd() < 0.2 ? base + (rnd() < 0.5 ? -1 : 1) : base; if (line < 0.5) line = 0.5; var sk = Math.round((mk - line) * 12); b[bk[0]] = [line, -112 - sk, -108 + sk]; });
            props.push({ p: nm, m: st, b: b });
            var d = {}; ['prizepicks', 'underdog', 'pick6'].forEach(function (app) { if (rnd() < 0.8) d[app] = Math.max(0.5, base + (rnd() < 0.3 ? (rnd() < 0.5 ? -1 : 1) : 0)); });
            if (Object.keys(d).length) dfs.push({ p: nm, m: st, b: d });
          });
        });
        var hp = Math.round(r.scoreH + nrm() * 1.5 - 0.5) + 0.5, ap = Math.round(r.scoreA + nrm() * 1.5 - 0.5) + 0.5;
        games.push({ id: 'fx' + r.id, commence: d + 'T23:00:00Z', home: r.home, away: r.away, home_norm: oNorm(r.home), away_norm: oNorm(r.away),
          spread: -Math.round(mm * 2) / 2, total: Math.round(tm * 2) / 2, books: books, props: props, dfs: dfs,
          tt: { draftkings: { home: [hp, -115, -105], away: [ap, -110, -110] } },
          h1: { fanduel: { sp: [-Math.round(mm * 0.47 * 2) / 2, -110, -110], to: [Math.round(tm * 0.475 * 2) / 2, -110, -110] } } });
      });
    });
    return { generated: new Date().toISOString(), fixture: true, games: games };
  }
  function has() { return !!(E.odds && E.odds.games && E.odds.games.some(function (x) { return x.books && Object.keys(x.books).length; })); }

  // ── match book games to our schedule rows ───────────────────────────────
  var MASCOT = null;
  function oNorm(n) {
    if (!MASCOT) MASCOT = new Set(('blue devils devils wildcats tigers bulldogs cougars gators aggies huskies volunteers cavaliers cyclones boilermakers jayhawks razorbacks fighting illini cardinals hurricanes eagles bears wolverines spartans hawkeyes gaels red raiders seahawks zips rams lopes utes hoosiers buckeyes badgers cornhuskers terrapins nittany lions demon deacons yellow jackets tar heels wolfpack orange hokies seminoles panthers knights bearcats bruins trojans sun devils golden gophers musketeers friars pirates bluejays gamecocks commodores rebels crimson tide mean green golden eagles ragin cajuns owls minutemen catamounts privateers redhawks red storm crimson vandals broncos mustangs lobos aztecs falcons flames phoenix runnin rebels anteaters gauchos toreros dons waves highlanders titans matadors 49ers roadrunners bobcats mountaineers').split(/\s+/));
    n = (n || '').toLowerCase().trim().replace(/&/g, 'and'); n = n.replace(/\bst\.?\b/g, 'state').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(university|univ|the|of)\b/g, ' ');
    return n.split(/\s+/).filter(function (t) { return t && !MASCOT.has(t); }).join(' ').trim();
  }
  var BYKEY = {};
  function index() {
    BYKEY = {};
    ((E.odds && E.odds.games) || []).forEach(function (x) { BYKEY[(x.home_norm || oNorm(x.home)) + '|' + (x.away_norm || oNorm(x.away))] = x; });
  }
  function bookGame(r) {
    var S = B.state(), h = S.byFull[r.home], a = S.byFull[r.away];
    var keys = [[oNorm(r.home), oNorm(r.away)], [oNorm(h && h.team), oNorm(a && a.team)]];
    for (var i = 0; i < keys.length; i++) { var x = BYKEY[keys[i][0] + '|' + keys[i][1]]; if (x) return { x: x, flip: false }; }
    for (i = 0; i < keys.length; i++) { x = BYKEY[keys[i][1] + '|' + keys[i][0]]; if (x) return { x: x, flip: true }; }
    return null;
  }

  // ── math ────────────────────────────────────────────────────────────────
  var phi = function (z) { return B.phi(z); };
  function dec(o) { return B.decimal(o); }
  function imp(o) { return B.implied(o); }
  function novig(a, b) { var pa = imp(a), pb = imp(b); if (pa == null || pb == null) return null; return pa / (pa + pb); }
  function median(xs) { xs = xs.filter(function (v) { return v != null && isFinite(v); }).sort(function (a, b) { return a - b; }); if (!xs.length) return null; var n = xs.length; return n % 2 ? xs[(n - 1) / 2] : (xs[n / 2 - 1] + xs[n / 2]) / 2; }
  function sigma() { return (g.TDC_RATINGS && TDC_RATINGS.SIGMA) || 11; }
  // the market's implied mean from a line + its no-vig chance of the "over/cover" side: invert the normal
  function impliedMean(line, pOver, sd) { var z = probit(Math.min(0.98, Math.max(0.02, pOver))); return line + z * sd; }
  function probit(p) {   // Acklam's inverse normal
    var a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239],
        b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572],
        c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783],
        d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416], q, r;
    if (p < 0.02425) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - 0.02425) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    q = p - 0.5; r = q * q; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  // ── platforms ───────────────────────────────────────────────────────────
  function kindOf(k, entry) { return (entry && entry.k) || (k === 'pinnacle' ? 'sharp' : EXCH[k] ? 'ex' : 'book'); }
  function isSharp(k, x) { return kindOf(k, x && x.books && x.books[k]) === 'sharp'; }
  // the market's number: median of the books, pulled SHARP_W of the way to Pinnacle when Pinnacle posts it
  function refMkt(rows, f, x) {
    var sh = [], rest = [];
    rows.forEach(function (r) { var v = f(r); if (v == null || !isFinite(v)) return; (isSharp(r.k, x) ? sh : rest).push(v); });
    var s = median(sh), m = median(rest);
    if (s == null) return { v: m, s: null };
    return { v: m == null ? s : SHARP_W * s + (1 - SHARP_W) * m, s: s };
  }
  function kelly(p, o) { var d = dec(o); if (!d || d <= 1) return 0; var f = (p * d - 1) / (d - 1); return Math.max(0, Math.min(0.02, f / 4)); }

  // ── prop distribution (negative binomial; see scripts/fit_prop_model.py) ──
  function nbOver(mu, v, line) {
    mu = Math.max(mu, 0.05); var k = Math.floor(line), cdf = 0, i;
    if (v <= mu * 1.0001) { var p0 = Math.exp(-mu), pk = p0; cdf = p0; for (i = 1; i <= k; i++) { pk *= mu / i; cdf += pk; } }
    else { var r = mu * mu / (v - mu), p = r / (r + mu), pk2 = Math.exp(r * Math.log(p)); cdf = pk2; for (i = 1; i <= k; i++) { pk2 *= (i - 1 + r) / i * (1 - p); cdf += pk2; } }
    return Math.min(0.999, Math.max(0.001, 1 - cdf));
  }
  function propVar(stat, mu, rate, sdm) {
    var m = E.model && E.model.stats && E.model.stats[stat], alpha = m && m.alpha != null ? m.alpha : { reb: 0.09, ast: 0.125, tpm: 0.185 }[stat] || 0.1;
    return mu + alpha * mu * mu + Math.pow(rate * (sdm == null ? 5 : sdm), 2) * 0.5;
  }
  // P(stat > line): points and P+R+A use a normal whose sd grows with the mean (sd = k·√μ + c·μ); rebounds,
  // assists and threes a negative binomial — the shapes that calibrated on 2025-26 (scripts/fit_prop_model.py)
  var NORMAL_DEF = { pts: { k: 1.8, c: 0.1 }, pra: { k: 2.0, c: 0 } };
  function pOver(stat, mu, rate, sdm, line) {
    var m = E.model && E.model.stats && E.model.stats[stat];
    var nd = m && m.dist === 'normal' ? m : (!m && NORMAL_DEF[stat]);
    if (nd) { var sd = nd.k * Math.sqrt(Math.max(mu, 0.1)) + nd.c * mu; return Math.min(0.999, Math.max(0.001, 1 - B.phi((line - mu) / sd))); }
    return nbOver(mu, propVar(stat, mu, rate, sdm), line);
  }
  var STATKEY = { pts: 'ppg', reb: 'rpg', ast: 'apg', tpm: 'tpm' };
  // our expected line for one player in one game: projection per minute, blended with this season's form,
  // x minutes, x the game's pace (and, for scoring, the opponent's defense, half weight)
  function propMean(pid, stat, r, isHome) {
    var S = B.state(), pr = S.PR && S.PR[pid]; if (!pr || !(pr.mpg > 0)) return null;
    var projRate = stat === 'pra' ? ((pr.ppg || 0) + (pr.rpg || 0) + (pr.apg || 0)) / pr.mpg : (pr[STATKEY[stat]] || 0) / pr.mpg;
    var f = E.form[pid], k = (E.model && E.model.stats && E.model.stats[stat] && E.model.stats[stat].k_prior) || 300, mk = 6;
    var rate = projRate, mpg = pr.mpg, sdm = null;
    if (f && f.g) {
      var tot = stat === 'pra' ? (f.tot.pts || 0) + (f.tot.reb || 0) + (f.tot.ast || 0) : (f.tot[stat] || 0);
      rate = (tot + projRate * k) / (f.min + k);
      mpg = (f.min + pr.mpg * mk) / (f.g + mk);
      sdm = f.sdm;
    }
    var eff = S.eff && S.eff.teams, me = eff && eff[isHome ? r.home : r.away], op = eff && eff[isHome ? r.away : r.home];
    var paceF = (r.pace && me && me.t) ? r.pace / me.t : 1;
    var defF = (op && S.eff.avgD && (stat === 'pts' || stat === 'tpm' || stat === 'pra')) ? 1 + 0.5 * (op.d / S.eff.avgD - 1) * (stat === 'pra' ? 0.6 : 1) : 1;
    var mu = rate * mpg * paceF * defF;
    return { mu: mu, rate: rate, mpg: mpg, sdm: sdm, form: !!(f && f.g), games: f ? f.g : 0 };
  }

  // ── names: book prop names → our players ───────────────────────────────
  var NAMES = null;
  function nkey(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim(); }
  var ID2NAME = {};
  function loadNames() {
    if (NAMES) return NAMES;
    (B.state().P || []).forEach(function (p) { if (p.name) ID2NAME[p.id] = p.name; });
    var SB = 'https://izlqhnxowdhtdofkwrho.supabase.co', KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye', out = {}, S = B.state();
    (S.P || []).forEach(function (p) { if (p.name) out[nkey(p.name)] = out[nkey(p.name)] || []; if (p.name) out[nkey(p.name)].push({ id: p.id, team: p.team }); });
    function page(from) {
      return fetch(SB + '/rest/v1/players?select=name,team,espn_id&espn_id=not.is.null&order=espn_id.asc', { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, Range: from + '-' + (from + 999) } })
        .then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; })
        .then(function (rows) { rows.forEach(function (x) { var k = nkey(x.name); (out[k] = out[k] || []).push({ id: String(x.espn_id), team: x.team }); ID2NAME[String(x.espn_id)] = x.name; }); return rows.length === 1000 ? page(from + 1000) : out; });
    }
    return (NAMES = page(0));
  }
  function matchPlayer(name, r, names) {
    var S = B.state(), c = names[nkey(name)]; if (!c) return null;
    var teams = [r.home, r.away], shorts = teams.map(function (t) { return (S.byFull[t] || {}).team; });
    for (var i = 0; i < c.length; i++) { var pr = S.PR && S.PR[c[i].id]; if (pr && teams.indexOf(pr.team) >= 0) return { id: c[i].id, home: pr.team === r.home }; }
    for (i = 0; i < c.length; i++) { var j = shorts.indexOf(c[i].team); if (j >= 0) return { id: c[i].id, home: j === 0 }; }
    return null;
  }

  // ── per game: every outcome at every book ──────────────────────────────
  function bet(o) { o.ev = o.p * dec(o.price) - 1; o.kelly = kelly(o.p, o.price); return o; }
  function title(bk, x) { return (x.books && x.books[bk] && x.books[bk].t) || bk; }

  function gameMarkets(r) {
    var m = bookGame(r); if (!m) return null;
    var x = m.x, fl = m.flip, out = [], books = x.books || {}, bks = Object.keys(books);
    var gl = function (H, A) { return fl ? [A, H] : [H, A]; };   // book home/away → our home/away
    var desc = B.short(r.away) + (r.neutral ? ' vs ' : ' @ ') + B.short(r.home);
    // spreads ─ consensus market margin (our home perspective) → blended margin → cover chance at each book's number
    var spRows = bks.map(function (k) { var s = books[k].sp; if (!s) return null; var hp = fl ? -s[0] : s[0], ph = fl ? s[2] : s[1], pa = fl ? s[1] : s[2]; return { k: k, hp: hp, ph: ph, pa: pa }; }).filter(Boolean);
    var spBet = spRows.filter(function (s) { return !isSharp(s.k, x); });
    if (spBet.length) {
      var spRef = refMkt(spRows, function (s) { return impliedMean(-s.hp, novig(s.ph, s.pa), sigma()); }, x), mm = spRef.v;   // market home margin
      var mb = W.spread * r.m + (1 - W.spread) * mm;
      ['home', 'away'].forEach(function (side) {
        var offers = spBet.map(function (s) { var pt = side === 'home' ? s.hp : -s.hp, me = side === 'home' ? mb : -mb, mo = side === 'home' ? r.m : -r.m, mk = side === 'home' ? mm : -mm;
          return bet({ market: 'spread', side: side, book: s.k, bookT: title(s.k, x), price: side === 'home' ? s.ph : s.pa, point: pt, p: B.coverP(me, pt), pOurs: B.coverP(mo, pt), pMkt: B.coverP(mk, pt) }); });
        var b = offers.slice().sort(function (a, c) { return c.ev - a.ev; })[0];
        b.label = B.short(side === 'home' ? r.home : r.away) + ' ' + B.spTxt(b.point); b.team = side === 'home' ? r.home : r.away; b.offers = offers;
        b.edgePts = (side === 'home' ? r.m - mm : mm - r.m); b.why = 'We make it ' + B.short(r.m >= 0 ? r.home : r.away) + ' by ' + Math.abs(r.m).toFixed(1) + '; the market ' + (spRef.s != null ? '(Pinnacle-weighted) ' : '') + 'has ' + B.short(mm >= 0 ? r.home : r.away) + ' by ' + Math.abs(mm).toFixed(1) + '.'; b.sharp = spRef.s != null;
        out.push(b);
      });
    }
    // totals
    var toRows = bks.map(function (k) { var t = books[k].to; return t ? { k: k, pt: t[0], po: t[1], pu: t[2] } : null; }).filter(Boolean);
    var toBet = toRows.filter(function (t) { return !isSharp(t.k, x); });
    if (toBet.length && r.tot != null) {
      var toRef = refMkt(toRows, function (t) { return impliedMean(t.pt, novig(t.po, t.pu), B.TOTAL_SD); }, x), tm = toRef.v;
      var tb = W.total * r.tot + (1 - W.total) * tm;
      ['over', 'under'].forEach(function (side) {
        var offers = toBet.map(function (t) { var po = B.overP(tb, t.pt); return bet({ market: 'total', side: side, book: t.k, bookT: title(t.k, x), price: side === 'over' ? t.po : t.pu, point: t.pt,
          p: side === 'over' ? po : 1 - po, pOurs: side === 'over' ? B.overP(r.tot, t.pt) : 1 - B.overP(r.tot, t.pt), pMkt: side === 'over' ? B.overP(tm, t.pt) : 1 - B.overP(tm, t.pt) }); });
        var b = offers.slice().sort(function (a, c) { return c.ev - a.ev; })[0];
        b.label = (side === 'over' ? 'Over ' : 'Under ') + b.point; b.team = r.home; b.offers = offers; b.edgePts = side === 'over' ? r.tot - tm : tm - r.tot;
        b.why = 'We project ' + Math.round(r.tot) + ' points; the market ' + (toRef.s != null ? '(Pinnacle-weighted) ' : '') + 'is at ' + tm.toFixed(1) + '.'; b.sharp = toRef.s != null; out.push(b);
      });
    }
    // moneylines
    var mlRows = bks.map(function (k) { var l = books[k].ml; if (!l) return null; var v = gl(l[0], l[1]); return { k: k, h: v[0], a: v[1] }; }).filter(Boolean);
    var mlBet = mlRows.filter(function (l) { return !isSharp(l.k, x); });
    if (mlBet.length) {
      var mlRef = refMkt(mlRows, function (l) { return novig(l.h, l.a); }, x), pm = mlRef.v;
      var pb = W.ml * r.probH / 100 + (1 - W.ml) * pm;
      ['home', 'away'].forEach(function (side) {
        var p = side === 'home' ? pb : 1 - pb;
        var offers = mlBet.map(function (l) { return bet({ market: 'ml', side: side, book: l.k, bookT: title(l.k, x), price: side === 'home' ? l.h : l.a, p: p, pOurs: side === 'home' ? r.probH / 100 : r.probA / 100, pMkt: side === 'home' ? pm : 1 - pm }); });
        var b = offers.slice().sort(function (a, c) { return c.ev - a.ev; })[0];
        b.label = B.short(side === 'home' ? r.home : r.away) + ' ML'; b.team = side === 'home' ? r.home : r.away; b.offers = offers;
        b.why = 'We give ' + B.short(b.team) + ' a ' + Math.round(b.pOurs * 100) + '% chance; the market' + (mlRef.s != null ? ' (Pinnacle-weighted)' : '') + ', ' + Math.round(b.pMkt * 100) + '%.'; b.sharp = mlRef.s != null; out.push(b);
      });
    }
    // team totals
    Object.keys(x.tt || {}).filter(function (k) { return !isSharp(k, x); }).forEach(function (k) {
      ['home', 'away'].forEach(function (bs) {
        var v = x.tt[k][bs]; if (!v || v[1] == null || v[2] == null) return;
        var side = fl ? (bs === 'home' ? 'away' : 'home') : bs, ours = side === 'home' ? r.scoreH : r.scoreA, full = side === 'home' ? r.home : r.away;
        var mkt = impliedMean(v[0], novig(v[1], v[2]), SD.team), mu = W.tt * ours + (1 - W.tt) * mkt, po = phi((mu - v[0]) / SD.team);
        [['over', v[1], po, phi((ours - v[0]) / SD.team)], ['under', v[2], 1 - po, 1 - phi((ours - v[0]) / SD.team)]].forEach(function (q) {
          out.push(bet({ market: 'tt', side: q[0], book: k, bookT: title(k, x), price: q[1], point: v[0], p: q[2], pOurs: q[3], pMkt: q[0] === 'over' ? phi((mkt - v[0]) / SD.team) : 1 - phi((mkt - v[0]) / SD.team),
            label: B.short(full) + ' team total ' + (q[0] === 'over' ? 'O ' : 'U ') + v[0], team: full, why: 'We project ' + B.short(full) + ' for ' + ours + ' points.' }));
        });
      });
    });
    // first half
    Object.keys(x.h1 || {}).filter(function (k) { return !isSharp(k, x); }).forEach(function (k) {
      var h = x.h1[k], mh = H1.m * r.m, th = r.tot != null ? H1.t * r.tot : null;
      if (h.sp && h.sp[1] != null) {
        var hp = fl ? -h.sp[0] : h.sp[0], ph = fl ? h.sp[2] : h.sp[1], pa = fl ? h.sp[1] : h.sp[2];
        var mk = impliedMean(-hp, novig(ph, pa), SD.h1m), mb2 = W.h1 * mh + (1 - W.h1) * mk;
        [['home', ph, hp, mb2, mh], ['away', pa, -hp, -mb2, -mh]].forEach(function (q) {
          out.push(bet({ market: 'h1', side: q[0], book: k, bookT: title(k, x), price: q[1], point: q[2], p: phi((q[3] + q[2]) / SD.h1m), pOurs: phi((q[4] + q[2]) / SD.h1m), pMkt: phi(((q[0] === 'home' ? mk : -mk) + q[2]) / SD.h1m),
            label: '1H ' + B.short(q[0] === 'home' ? r.home : r.away) + ' ' + B.spTxt(q[2]), team: q[0] === 'home' ? r.home : r.away, why: 'First half ≈ ' + Math.round(H1.m * 100) + '% of our full-game margin (' + B.spTxt(-Math.abs(mh)) + ').' }));
        });
      }
      if (h.to && h.to[1] != null && th != null) {
        var tk = impliedMean(h.to[0], novig(h.to[1], h.to[2]), SD.h1t), tb2 = W.h1 * th + (1 - W.h1) * tk, po2 = phi((tb2 - h.to[0]) / SD.h1t);
        [['over', h.to[1], po2], ['under', h.to[2], 1 - po2]].forEach(function (q) {
          out.push(bet({ market: 'h1', side: q[0], book: k, bookT: title(k, x), price: q[1], point: h.to[0], p: q[2], pOurs: q[0] === 'over' ? phi((th - h.to[0]) / SD.h1t) : 1 - phi((th - h.to[0]) / SD.h1t), pMkt: q[0] === 'over' ? phi((tk - h.to[0]) / SD.h1t) : 1 - phi((tk - h.to[0]) / SD.h1t),
            label: '1H ' + (q[0] === 'over' ? 'Over ' : 'Under ') + h.to[0], team: r.home, why: 'We project ' + Math.round(th) + ' first-half points.' }));
        });
      }
    });
    // alternate lines: same blended distributions, priced point by point
    var mmA = spRows.length ? W.alt * r.m + (1 - W.alt) * refMkt(spRows, function (s) { return impliedMean(-s.hp, novig(s.ph, s.pa), sigma()); }, x).v : null;
    var tmA = toRows.length && r.tot != null ? W.alt * r.tot + (1 - W.alt) * refMkt(toRows, function (t) { return impliedMean(t.pt, novig(t.po, t.pu), B.TOTAL_SD); }, x).v : null;
    Object.keys(x.alt || {}).filter(function (k) { return !isSharp(k, x); }).forEach(function (k) {
      var a = x.alt[k];
      if (mmA != null) (a.sp || []).forEach(function (v) { var hp = fl ? -v[0] : v[0], ph = fl ? v[2] : v[1], pa = fl ? v[1] : v[2];
        out.push(bet({ market: 'alt', side: 'home', book: k, bookT: title(k, x), price: ph, point: hp, p: B.coverP(mmA, hp), pOurs: B.coverP(r.m, hp), pMkt: null, label: 'Alt ' + B.short(r.home) + ' ' + B.spTxt(hp), team: r.home, why: 'Alternate spread, priced from the same blended margin.' }));
        out.push(bet({ market: 'alt', side: 'away', book: k, bookT: title(k, x), price: pa, point: -hp, p: B.coverP(-mmA, -hp), pOurs: B.coverP(-r.m, -hp), pMkt: null, label: 'Alt ' + B.short(r.away) + ' ' + B.spTxt(-hp), team: r.away, why: 'Alternate spread, priced from the same blended margin.' })); });
      if (tmA != null) (a.to || []).forEach(function (v) {
        out.push(bet({ market: 'alt', side: 'over', book: k, bookT: title(k, x), price: v[1], point: v[0], p: B.overP(tmA, v[0]), pOurs: B.overP(r.tot, v[0]), pMkt: null, label: 'Alt Over ' + v[0], team: r.home, why: 'Alternate total, priced from the same blended total.' }));
        out.push(bet({ market: 'alt', side: 'under', book: k, bookT: title(k, x), price: v[2], point: v[0], p: 1 - B.overP(tmA, v[0]), pOurs: 1 - B.overP(r.tot, v[0]), pMkt: null, label: 'Alt Under ' + v[0], team: r.home, why: 'Alternate total, priced from the same blended total.' })); });
    });
    out.forEach(function (o) { o.gid = r.id; o.date = r.date; o.game = desc; o.row = r; o.tip = x.commence; });
    return { x: x, flip: fl, bets: out, props: x.props || [] };
  }

  function propBets(r, names) {
    var gm = bookGame(r); if (!gm || !gm.x.props) return [];
    var out = [], desc = B.short(r.away) + (r.neutral ? ' vs ' : ' @ ') + B.short(r.home);
    gm.x.props.forEach(function (pp) {
      var who = null;
      if (pp.pid) {                      // free DraftKings feed (cbb-live.js): ESPN athlete ids are our player ids
        var prx = B.state().PR && B.state().PR[pp.pid];
        if (prx && (prx.team === r.home || prx.team === r.away)) who = { id: String(pp.pid), home: prx.team === r.home };
        if (!pp.p) pp.p = ID2NAME[pp.pid] || null;
      } else who = matchPlayer(pp.p, r, names);
      if (!who || !pp.p) return;
      var pm = propMean(who.id, pp.m, r, who.home); if (!pm) return;
      var all = Object.keys(pp.b), bks = all.filter(function (k) { return !isSharp(k, gm.x); }); if (!bks.length) return;
      // market mean: invert the NB at the consensus line from each book's no-vig over chance
      var mkMu = refMkt(all.map(function (k) { return { k: k }; }), function (q) { var v = pp.b[q.k]; return solveMu(pp.m, v[0], novig(v[1], v[2]), pm); }, gm.x).v;
      var muB = W.prop * pm.mu + (1 - W.prop) * (mkMu != null ? mkMu : pm.mu);
      ['over', 'under'].forEach(function (side) {
        var offers = bks.map(function (k) { var v = pp.b[k], line = v[0];
          var pB = pOver(pp.m, muB, pm.rate, pm.sdm, line), pO = pOver(pp.m, pm.mu, pm.rate, pm.sdm, line), pK = mkMu != null ? pOver(pp.m, mkMu, pm.rate, pm.sdm, line) : null;
          return bet({ market: 'prop', side: side, book: k, bookT: title(k, gm.x), price: side === 'over' ? v[1] : v[2], point: line,
            p: side === 'over' ? pB : 1 - pB, pOurs: side === 'over' ? pO : 1 - pO, pMkt: pK == null ? null : (side === 'over' ? pK : 1 - pK) }); });
        var b = offers.slice().sort(function (a, c) { return c.ev - a.ev; })[0];
        b.label = pp.p + ' ' + (side === 'over' ? 'O ' : 'U ') + b.point + ' ' + B.STAT_ABBR[pp.m]; b.player = pp.p; b.pid = who.id; b.stat = pp.m;
        var lines = offers.map(function (o) { return o.point; }).sort(function (x, y) { return x - y; }), medL = lines[Math.floor(lines.length / 2)];
        b.offLine = lines.length >= 2 && b.point !== medL;                 // this book hangs a different number than the rest
        b.team = who.home ? r.home : r.away; b.offers = offers; b.mu = pm.mu; b.mkMu = mkMu; b.form = pm.form; b.formG = pm.games;
        b.edgePts = side === 'over' ? pm.mu - (mkMu != null ? mkMu : b.point) : (mkMu != null ? mkMu : b.point) - pm.mu;
        b.why = 'We project ' + pm.mu.toFixed(1) + ' ' + B.STAT_NAME[pp.m].toLowerCase() + ' (' + Math.round(pm.mpg) + ' min' + (pm.form ? ', ' + pm.games + ' games this season' : ', preseason projection') + ')' + (mkMu != null ? '; the books imply ' + mkMu.toFixed(1) + '.' : '.');
        b.gid = r.id; b.date = r.date; b.game = desc; b.row = r; b.tip = gm.x.commence;
        out.push(b);
      });
    });
    return out;
  }
  function solveMu(stat, line, pOv, pm) {
    if (pOv == null) return null;
    var lo = 0.1, hi = Math.max(3, line * 3);
    for (var i = 0; i < 40; i++) { var mid = (lo + hi) / 2; if (pOver(stat, mid, pm.rate, pm.sdm, line) < pOv) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }

  // ── the board ───────────────────────────────────────────────────────────
  // one bet per (game, market type, side-group): the single best EV; alternate lines only when far better
  function board(rows, opts) {
    opts = opts || {};
    var out = [];
    rows.forEach(function (r) {
      if (r.exh) return;
      var gm = gameMarkets(r); if (!gm) return;
      var groups = {};
      gm.bets.forEach(function (b) {
        var key = b.market === 'tt' ? 'tt:' + b.team : b.market === 'h1' ? 'h1:' + (b.side === 'over' || b.side === 'under' ? 'to' : 'sp') : b.market === 'alt' ? 'alt' : b.market;
        if (!groups[key] || b.ev > groups[key].ev) groups[key] = b;
      });
      Object.keys(groups).forEach(function (k) { out.push(groups[k]); });
    });
    return filter(out, opts);
  }
  function filter(list, opts) {
    var my = opts.books && opts.books.length ? opts.books : null;
    return list.map(function (b) {
      if (!my || !b.offers) return b;
      var mine = b.offers.filter(function (o) { return my.indexOf(o.book) >= 0; }).sort(function (a, c) { return c.ev - a.ev; })[0];
      return mine ? Object.assign({}, b, { book: mine.book, bookT: mine.bookT, price: mine.price, point: mine.point, p: mine.p, ev: mine.ev, kelly: mine.kelly, label: relabel(b, mine) }) : null;
    }).filter(function (b) { return b && (opts.showSuspect || !suspect(b)) && b.ev >= (opts.minEv != null ? opts.minEv : MIN_EV[b.market]); })
      .sort(function (a, c) { return rankEv(c) - rankEv(a); });
  }
  // off-market lines rank at half weight: real but fragile (they get moved, or voided as palpable errors)
  function rankEv(b) { return b.offLine ? b.ev * 0.5 : b.ev; }
  // a price this far off is almost always a stale or mis-posted line (it'll be pulled or voided), not an edge
  var MAX_EV = { spread: 0.15, total: 0.15, ml: 0.25, tt: 0.18, h1: 0.18, alt: 0.25, prop: 0.25 };
  function suspect(b) {
    if (b.ev > MAX_EV[b.market]) return true;
    if (b.market === 'prop' && (b.p > 0.8 || b.p < 0.2)) return true;
    if ((b.market === 'spread' || b.market === 'total') && b.offers) {                 // a number no other book is near
      var pts = b.offers.map(function (o) { return o.point; }).sort(function (x, y) { return x - y; }), med = pts[Math.floor(pts.length / 2)];
      if (pts.length >= 3 && Math.abs(b.point - med) >= 2.5) return true;
    }
    return false;
  }
  function relabel(b, o) {
    if (b.market === 'spread') return B.short(b.team) + ' ' + B.spTxt(o.point);
    if (b.market === 'total') return (b.side === 'over' ? 'Over ' : 'Under ') + o.point;
    if (b.market === 'prop') return b.player + ' ' + (b.side === 'over' ? 'O ' : 'U ') + o.point + ' ' + B.STAT_ABBR[b.stat];
    return b.label;
  }
  function props(rows, opts) {
    return loadNames().then(function (names) {
      var out = []; rows.forEach(function (r) { if (!r.exh) out = out.concat(propBets(r, names)); });
      return opts && opts.all ? out : filter(out, opts || {});
    });
  }
  function books() {
    var seen = {};
    ((E.odds && E.odds.games) || []).forEach(function (x) { Object.keys(x.books || {}).forEach(function (k) { var kd = kindOf(k, x.books[k]); if (kd === 'sharp') return; seen[k] = seen[k] || { key: k, title: x.books[k].t || k, n: 0, kind: kd }; seen[k].n++; }); });
    return Object.keys(seen).map(function (k) { return seen[k]; }).sort(function (a, b) { return b.n - a.n; });
  }
  function hasSharp() { return ((E.odds && E.odds.games) || []).some(function (x) { return Object.keys(x.books || {}).some(function (k) { return isSharp(k, x); }); }); }

  // ── DFS pick'em lines: the app posts a line, you pick More or Less, it pays a fixed multiplier for the whole entry.
  //    Our chance per pick = the same blend as a sportsbook prop: our projected line, pulled toward what the sportsbooks'
  //    prices imply for that player + stat when they post it (else our number alone, flagged noMkt). bet-dfs.js turns
  //    these chances into entries. One row per player + stat; apps = {app: {line, pOver}}.
  function dfsLines(r, names) {
    var gm = bookGame(r); if (!gm || !gm.x.dfs) return [];
    var out = [], desc = B.short(r.away) + (r.neutral ? ' vs ' : ' @ ') + B.short(r.home), sb = {};
    (gm.x.props || []).forEach(function (pp) { if (pp.p) sb[nkey(pp.p) + '|' + pp.m] = pp; });
    gm.x.dfs.forEach(function (dl) {
      var who = matchPlayer(dl.p, r, names); if (!who) return;
      var pm = propMean(who.id, dl.m, r, who.home); if (!pm) return;
      var bp = sb[nkey(dl.p) + '|' + dl.m], mkMu = null, bookLine = null;
      if (bp) {
        var all = Object.keys(bp.b || {});
        mkMu = refMkt(all.map(function (k) { return { k: k }; }), function (q) { var v = bp.b[q.k]; return v && v[1] != null && v[2] != null ? solveMu(dl.m, v[0], novig(v[1], v[2]), pm) : null; }, gm.x).v;
        var ls = all.map(function (k) { return bp.b[k][0]; }).sort(function (a, b) { return a - b; }); bookLine = ls.length ? ls[Math.floor(ls.length / 2)] : null;
      }
      var mu = mkMu != null ? W.prop * pm.mu + (1 - W.prop) * mkMu : pm.mu, apps = {};
      Object.keys(dl.b).forEach(function (app) { var line = dl.b[app]; if (line == null) return; apps[app] = { line: line, pOver: pOver(dl.m, mu, pm.rate, pm.sdm, line), pOurs: pOver(dl.m, pm.mu, pm.rate, pm.sdm, line) }; });
      if (!Object.keys(apps).length) return;
      out.push({ player: dl.p, pid: who.id, stat: dl.m, team: who.home ? r.home : r.away, game: desc, gid: r.id, date: r.date, row: r, tip: gm.x.commence,
        mu: pm.mu, mkMu: mkMu, muB: mu, bookLine: bookLine, noMkt: mkMu == null, form: pm.form, formG: pm.games, apps: apps });
    });
    return out;
  }
  function dfs(rows) {
    return loadNames().then(function (names) { var out = []; rows.forEach(function (r) { if (!r.exh) out = out.concat(dfsLines(r, names)); }); return out; });
  }
  // the selection a bet puts on the slip
  function sel(b) {
    return { key: 'e:' + b.gid + ':' + b.market + ':' + b.side + ':' + (b.pid || '') + (b.stat || '') + ':' + b.point, gid: b.gid, date: b.date,
      market: b.market === 'prop' ? 'prop' : b.market === 'total' ? 'total' : b.market === 'spread' ? 'spread' : b.market === 'ml' ? 'ml' : 'other',
      side: b.side, team: b.team, pid: b.pid, stat: b.stat, label: b.label + ' @ ' + b.bookT, sub: b.game, line: b.point, price: b.price, p: b.p, book: true };
  }

  // ── free live prices (cbb-live.js): merge a slate's DraftKings / Kalshi / Polymarket prices into the board, then
  //    keep them fresh every 75 s while the page is visible and a game in the slate hasn't tipped. Pages register
  //    onUpdate(cb) to repaint. Feed-file games (odds_live.json, the paid feed) are kept; live ones fill the rest.
  var LIVE = { rows: null, t: null, cbs: [], at: null, ok: null, busy: false };
  function live(rows) {
    if (!g.TDCLive || E.fixture) return Promise.resolve(E);
    LIVE.rows = rows;
    return pull().then(function () { schedule(); return E; });
  }
  function pull() {
    if (LIVE.busy || !LIVE.rows) return Promise.resolve();
    LIVE.busy = true;
    return TDCLive.odds(LIVE.rows).then(function (o) {
      var base = ((E.odds && E.odds.games) || []).filter(function (x) { return !x.live; });
      var have = {}; base.forEach(function (x) { have[(x.home_norm || oNorm(x.home)) + '|' + (x.away_norm || oNorm(x.away))] = 1; });
      var add = (o.games || []).filter(function (x) { return !have[oNorm(x.home) + '|' + oNorm(x.away)]; });
      E.odds = { generated: o.generated, games: base.concat(add), live: true };
      LIVE.at = o.generated; LIVE.ok = o.ok; index();
    }).catch(function () {}).then(function () { LIVE.busy = false; });
  }
  function schedule() {
    clearTimeout(LIVE.t);
    var pre = (LIVE.rows || []).some(function (r) { return !r.exh; }) && ((E.odds && E.odds.games) || []).some(function (x) { return x.live && Date.parse(x.commence) > Date.now(); });
    if (!pre) return;
    LIVE.t = setTimeout(function () {
      if (document.hidden) { schedule(); return; }
      pull().then(function () { LIVE.cbs.forEach(function (cb) { try { cb(); } catch (e) {} }); schedule(); });
    }, 75000);
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', function () { if (!document.hidden && LIVE.rows) { pull().then(function () { LIVE.cbs.forEach(function (cb) { try { cb(); } catch (e) {} }); schedule(); }); } });

  g.TDCEdge = { live: live, onUpdate: function (cb) { LIVE.cbs.push(cb); }, liveInfo: function () { return { at: LIVE.at, ok: LIVE.ok }; }, load: load, has: has, game: gameMarkets, board: board, props: props, dfs: dfs, raw: function () { return (E.odds && E.odds.games) || []; }, hasSharp: hasSharp, kindOf: kindOf, suspect: function (b) { return suspect(b); }, books: books, sel: sel, W: W, MIN_EV: MIN_EV,
    fixture: function () { return E.fixture; }, stamp: function () { return E.odds && E.odds.generated; }, propMean: propMean, pOver: pOver };
})(window);
