// TDC Bet arb alerts: scans every sport for sure bets and no-lose middles once a minute and pushes new ones to the
// owner's phone (Web Push to the installed TDC Bet app). Same pulls and math as the Arbs page: the paid feed
// (api/odds.js) + Kalshi/Polymarket direct (api/pm.js), joined and scanned by bet/bet-arb.js.
//
// Triggered every minute by a Supabase pg_cron job (scripts/arb_alerts.sql), which passes a key that lives only in the
// database; the scanner hands that key back to the database to read and write its state, so no service key is needed.
//
// Cadence and credits (the paid feed costs ~12 credits per sport per pull, the exchanges are free):
//   - today's games only (until midnight ET): money in an arb is tied up until the game ends
//   - basketball, football and hockey every minute; MLB, soccer and MMA every 5 minutes
//   - a sport with no game left today costs nothing (checked first on the free /events endpoint)
//   - over SOFT_CAP credits today everything drops to every 5 minutes; over HARD_CAP, or under FLOOR credits left
//     on the plan, the paid feed stops for the day and only Kalshi + Polymarket are scanned
//
//   GET  /api/arb-scan?cron=1   (header x-cron-key)      run one scan
//   (owner: Authorization: Bearer <owner's Supabase access token>)
//   GET  /api/arb-scan?status=1                         → scanner state, settings, devices, recent sightings
//   GET  /api/arb-scan?vapid=1                          → { key } the push public key (made on first use)
//   POST /api/arb-scan?subscribe=1  {sub, prefs}        add this device (sub = PushSubscription JSON)
//   POST /api/arb-scan?unsubscribe=1 {endpoint}
//   POST /api/arb-scan?prefs=1  {prefs}                 {minRet, middles, places: all|ex|mine, books: [...]}
//   POST /api/arb-scan?test=1                           send a test alert to every device
//   POST /api/arb-scan?run=1                            scan now (skips the once-a-minute guard)

var odds = require('./odds.js');
var pm = require('./pm.js');
require('../bet/bet-arb.js');
var webpush = require('web-push');
var A = globalThis.TDCArb;

var SB = 'https://izlqhnxowdhtdofkwrho.supabase.co';
var SB_KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
var OWNER = 'blee4824@gmail.com';
var SITE = 'https://www.thedepthchartcbb.com';
// what gets scanned (the Arbs page's default sports); CORE every minute, the rest every 5
var WATCH = ['basketball_ncaab', 'basketball_nba', 'basketball_wnba', 'americanfootball_nfl', 'americanfootball_ncaaf', 'icehockey_nhl', 'baseball_mlb',
  'soccer_epl', 'soccer_uefa_champs_league', 'soccer_spain_la_liga', 'soccer_italy_serie_a', 'soccer_germany_bundesliga', 'soccer_france_ligue_one', 'soccer_usa_mls', 'mma_mixed_martial_arts'];
var CORE = { basketball_ncaab: 1, basketball_nba: 1, basketball_wnba: 1, americanfootball_nfl: 1, americanfootball_ncaaf: 1, icehockey_nhl: 1 };
var FAST = 60e3, SLOW = 300e3;
var SOFT_CAP = 120000, HARD_CAP = 160000, FLOOR = 300000;
var GRACE = 6 * 60e3;        // unseen this long = gone (5-minute sports are only priced every 5 minutes)
var REALERT = 30 * 60e3;     // the same bet coming back inside this window doesn't alert again
var PREFS = { minRet: 0.01, middles: true, places: 'all', books: [] };

var owners = {};
async function isOwner(token) {
  if (!token) return false;
  var hit = owners[token]; if (hit && hit > Date.now()) return true;
  try {
    var r = await fetch(SB + '/auth/v1/user', { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + token } });
    if (!r.ok) return false;
    var u = await r.json();
    if (String(u.email || '').toLowerCase() !== OWNER) return false;
    owners[token] = Date.now() + 5 * 60000;
    return true;
  } catch (e) { return false; }
}

// the database functions in scripts/arb_alerts.sql; who = {secret} (the cron job's key) or {token} (the owner)
async function rpc(fn, args, who) {
  var h = { apikey: SB_KEY, 'Content-Type': 'application/json' };
  if (who.token) h.Authorization = 'Bearer ' + who.token;
  var r = await fetch(SB + '/rest/v1/rpc/' + fn, { method: 'POST', headers: h, body: JSON.stringify(Object.assign({ p_secret: who.secret || null }, args)) });
  var t = await r.text();
  if (!r.ok) throw new Error(fn + ' ' + r.status + ' ' + t.slice(0, 200));
  return t ? JSON.parse(t) : null;
}
function kvGet(keys, who) { return rpc('arb_kv_get', { p_keys: keys }, who); }
function kvSet(vals, who) { return rpc('arb_kv_set', { p_vals: vals }, who); }

// ── Eastern time: "today" ends at midnight ET ──
function etParts(t) {
  var o = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(t)).forEach(function (p) { o[p.type] = p.value; });
  return o;
}
function etDay(t) { var o = etParts(t); return o.year + '-' + o.month + '-' + o.day; }
function etDayEnd(t) { var o = etParts(t); return t + (86400 - (+o.hour * 3600 + +o.minute * 60 + +o.second)) * 1000; }
function etTime(c) { return c ? new Date(c).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).replace(':00', '').replace(' ', '').toLowerCase() : ''; }

async function vapidOf(kv, who) {
  if (kv.vapid && kv.vapid.pub) return kv.vapid;
  var k = webpush.generateVAPIDKeys(), v = { pub: k.publicKey, priv: k.privateKey };
  await kvSet({ vapid: v }, who);
  return v;
}
// send to every device; a device the push service says is gone (404/410) is dropped
async function pushAll(vapid, subs, payload) {
  webpush.setVapidDetails(SITE, vapid.pub, vapid.priv);
  var keep = [], sent = 0, errors = [];
  await Promise.all(subs.map(function (s) {
    return webpush.sendNotification(s.sub, JSON.stringify(payload), { TTL: 900, urgency: 'high' })
      .then(function () { sent++; keep.push(s); })
      .catch(function (e) { if (e.statusCode === 404 || e.statusCode === 410) return; errors.push(e.statusCode || String(e.message || e)); keep.push(s); });
  }));
  return { keep: keep, sent: sent, errors: errors };
}

// ── one opportunity, as the notification and the sightings log see it ──
function okey(kind, o) { return kind + '|' + o.gid + '|' + o.legs.map(function (l) { return l.label + '@' + l.book; }).join('|'); }
function pct(v) { return (v * 100).toFixed(2) + '%'; }
function line(f, titles) {
  var o = f.o, sp = titles[o.sport] || o.sport;
  var head = f.kind === 'arb' ? '+' + pct(o.ret) + (o.ret > 0.05 ? ' (check price)' : '') : 'No-lose middle, ' + (o.pBoth * 100).toFixed(0) + '% both win';
  return head + ' · ' + o.legs.map(function (l) { return l.label + ' ' + (l.price > 0 ? '+' : '') + l.price + ' ' + l.bookT; }).join(' / ') + ' · ' + sp + ' ' + etTime(o.commence);
}

async function scan(who, force) {
  var now = Date.now(), kv = await kvGet(['state', 'subs', 'prefs', 'vapid', 'lock'], who);
  if (!force && kv.lock && now - kv.lock < 50e3) return { skipped: 'already ran ' + Math.round((now - kv.lock) / 1000) + ' s ago' };
  await kvSet({ lock: now }, who);
  var st = kv.state || {}, prefs = Object.assign({}, PREFS, kv.prefs || {}), subs = kv.subs || [];
  var day = etDay(now);
  if (st.day !== day) { st.day = day; st.used = 0; st.alerts = 0; st.found = 0; }
  st.last = st.last || {}; st.skel = st.skel || {}; st.seen = st.seen || {}; st.recent = st.recent || {};
  var win = { from: now + 60e3, to: etDayEnd(now) }, inWin = function (c) { var t = Date.parse(c); return t > win.from - 60e3 && t <= win.to; };
  var key = process.env.ODDS_API_KEY;
  var mode = !key ? 'no key' : st.remaining != null && st.remaining < FLOOR ? 'plan low' : st.used >= HARD_CAP ? 'hard cap' : st.used >= SOFT_CAP ? 'soft cap' : 'normal';

  // paid feed: the sports that are due, in season, with a game left today
  var titles = {}, inSeason = {};
  Object.keys(pm.SPORTS).forEach(function (k) { titles[k] = pm.SPORTS[k].title; });
  if (key && (mode === 'normal' || mode === 'soft cap')) {
    try { (await odds.sportList(key)).forEach(function (s) { inSeason[s.key] = 1; titles[s.key] = s.title; }); } catch (e) {}
  }
  var due = WATCH.filter(function (sp) { return inSeason[sp] && now - (st.last[sp] || 0) >= (mode === 'soft cap' || !CORE[sp] ? SLOW : FAST) - 20e3; });
  var paid = {}, used = 0, failed = [];
  await Promise.all(due.map(async function (sp) {
    try {
      var n = await odds.eventCount(key, sp, win);
      st.last[sp] = now;
      if (!n) { delete st.skel[sp]; return; }
      var b = await odds.sportBoard(key, sp, titles, win);
      if (!b.cached) used += b.used || 0;
      if (b.remaining != null) st.remaining = b.remaining;
      failed = failed.concat(b.failed || []);
      paid[sp] = b.games;
      // the game list without prices: the minutes in between join Kalshi/Polymarket onto the same games (same ids
      // and names, so the same bet isn't alerted twice under two names)
      st.skel[sp] = b.games.map(function (x) { return { id: x.id, commence: x.commence, home: x.home, away: x.away, spread: x.spread, total: x.total, sport: sp, sportT: x.sportT, snapshot: x.snapshot }; });
    } catch (e) { failed.push(sp + ' ' + e.message); }
  }));
  st.used = (st.used || 0) + used;

  // prediction markets: every sport they cover, every minute (free)
  var pmg = {};
  await Promise.all(WATCH.filter(function (sp) { return pm.SPORTS[sp]; }).map(function (sp) {
    return pm.board(sp).then(function (d) { pmg[sp] = (d.games || []).filter(function (g) { return inWin(g.commence); }); }).catch(function () {});
  }));

  var games = [];
  WATCH.forEach(function (sp) {
    var base = paid[sp] || (st.skel[sp] || []).filter(function (x) { return inWin(x.commence); }).map(function (x) { return Object.assign({ books: {} }, x); });
    var g = pmg[sp] && pmg[sp].length ? A.join(base, pmg[sp], sp) : base;
    games = games.concat(g.map(function (x) { return x.sport ? x : Object.assign({}, x, { sport: sp }); }));
  });

  var R = A.scan(games, { books: prefs.places === 'mine' ? prefs.books || [] : [], now: now }), found = [];
  var okPlace = function (o) { return prefs.places !== 'ex' || o.allEx; };
  R.arbs.forEach(function (o) { if (!o.sameBook && o.market !== 'prop' && inWin(o.commence) && okPlace(o) && o.ret >= prefs.minRet) found.push({ kind: 'arb', o: o, val: o.ret }); });
  if (prefs.middles) R.middles.forEach(function (m) { if (m.noLose && inWin(m.commence) && okPlace(m)) found.push({ kind: 'middle', o: m, val: m.ev }); });

  // what's new: never seen, and not alerted in the last half hour
  var fresh = [];
  found.forEach(function (f) {
    var k = okey(f.kind, f.o), s = st.seen[k];
    if (!s) {
      s = st.seen[k] = { kind: f.kind, sport: f.o.sport, game: f.o.game, market: f.o.market, commence: f.o.commence, first: now, firstVal: f.val, best: f.val,
        legs: f.o.legs.map(function (l) { return { label: l.label, book: l.bookT || l.book, price: l.price }; }), alerted: false };
      if (!st.recent[k] || now - st.recent[k] > REALERT) fresh.push(f);
      s.k = k;
    }
    s.last = now; s.best = Math.max(s.best, f.val);
  });

  // gone (or started): into the sightings log
  var gone = [];
  Object.keys(st.seen).forEach(function (k) {
    var s = st.seen[k];
    if (now - s.last > GRACE || Date.parse(s.commence) <= now) {
      gone.push({ key: k, kind: s.kind, sport: s.sport, game: s.game, market: s.market, legs: s.legs, best_ret: s.best, first_ret: s.firstVal,
        first_seen: new Date(s.first).toISOString(), last_seen: new Date(s.last).toISOString(), commence: s.commence || null, alerted: !!s.alerted });
      delete st.seen[k];
    }
  });
  Object.keys(st.recent).forEach(function (k) { if (now - st.recent[k] > 3 * 3600e3) delete st.recent[k]; });

  var push = null;
  if (fresh.length && subs.length) {
    fresh.sort(function (a, b) { return (a.kind === 'arb' ? 0 : 1) - (b.kind === 'arb' ? 0 : 1) || b.val - a.val; });
    var na = fresh.filter(function (f) { return f.kind === 'arb'; }).length, nm = fresh.length - na;
    var title = fresh.length === 1 ? (na ? 'Sure bet +' + pct(fresh[0].val) : 'No-lose middle') :
      [na ? na + ' sure bet' + (na > 1 ? 's' : '') : '', nm ? nm + ' no-lose middle' + (nm > 1 ? 's' : '') : ''].filter(Boolean).join(' + ');
    var body = fresh.slice(0, 3).map(function (f) { return line(f, titles); }).join('\n') + (fresh.length > 3 ? '\n+' + (fresh.length - 3) + ' more' : '');
    push = await pushAll(await vapidOf(kv, who), subs, { title: title, body: body, tag: 'arb-' + now });
    if (push.keep.length !== subs.length) await kvSet({ subs: push.keep }, who);
    fresh.forEach(function (f) { var k = okey(f.kind, f.o); st.recent[k] = now; if (st.seen[k]) st.seen[k].alerted = true; });
    st.alerts = (st.alerts || 0) + 1;
  }
  st.found = (st.found || 0) + fresh.length;
  st.lastRun = now; st.mode = mode;
  st.lastResult = { games: games.length, paid: Object.keys(paid), due: due.length, pm: Object.keys(pmg).reduce(function (t, k) { return t + pmg[k].length; }, 0),
    arbs: found.filter(function (f) { return f.kind === 'arb'; }).length, middles: found.filter(function (f) { return f.kind === 'middle'; }).length,
    fresh: fresh.length, used: used, failed: failed.slice(0, 8), pushed: push ? push.sent : 0, pushErrors: push ? push.errors : [], ms: Date.now() - now };
  await kvSet({ state: st }, who);
  if (gone.length) await rpc('arb_sightings_add', { p_rows: gone }, who).catch(function () {});
  return st.lastResult;
}

async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return new Promise(function (res) { var d = ''; req.on('data', function (c) { d += c; }); req.on('end', function () { try { res(JSON.parse(d || '{}')); } catch (e) { res({}); } }); });
}

module.exports = async function (req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'private, no-store');
  var out = function (code, d) { res.statusCode = code; res.end(JSON.stringify(d)); };
  try {
    var url = new URL(req.url, 'http://x'), q = function (k) { return url.searchParams.get(k); };
    if (q('cron')) {
      var secret = String(req.headers['x-cron-key'] || '');
      if (secret.length < 32) return out(403, { error: 'no key' });
      return out(200, await scan({ secret: secret }, false));
    }
    var token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!(await isOwner(token))) return out(403, { error: 'owner only' });
    var who = { token: token };
    if (q('run')) return out(200, await scan(who, true));
    if (q('vapid')) return out(200, { key: (await vapidOf(await kvGet(['vapid'], who), who)).pub });
    if (q('status')) {
      var kv = await kvGet(['state', 'subs', 'prefs'], who), st = kv.state || {};
      var live = Object.keys(st.seen || {}).map(function (k) { var s = st.seen[k]; return { kind: s.kind, sport: s.sport, game: s.game, market: s.market, legs: s.legs, best: s.best, first: s.first, last: s.last, commence: s.commence, alerted: s.alerted }; });
      var recent = await rpc('arb_sightings_recent', { p_limit: 40 }, who).catch(function () { return []; });
      return out(200, { lastRun: st.lastRun || null, day: st.day, used: st.used || 0, remaining: st.remaining, mode: st.mode, alerts: st.alerts || 0, found: st.found || 0,
        last: st.lastResult || null, caps: { soft: SOFT_CAP, hard: HARD_CAP, floor: FLOOR }, prefs: Object.assign({}, PREFS, kv.prefs || {}),
        devices: (kv.subs || []).map(function (s) { return { ua: s.ua, at: s.at, endpoint: s.sub && s.sub.endpoint }; }), live: live, recent: recent });
    }
    if (req.method !== 'POST') return out(400, { error: 'unknown request' });
    var b = await body(req);
    if (q('subscribe')) {
      if (!b.sub || !b.sub.endpoint || !b.sub.keys) return out(400, { error: 'no subscription' });
      var cur = await kvGet(['subs'], who), subs = (cur.subs || []).filter(function (s) { return s.sub.endpoint !== b.sub.endpoint; });
      subs.push({ sub: b.sub, ua: String(b.ua || '').slice(0, 120), at: new Date().toISOString() });
      var vals = { subs: subs.slice(-6) }; if (b.prefs) vals.prefs = b.prefs;
      await kvSet(vals, who);
      return out(200, { ok: true, devices: vals.subs.length });
    }
    if (q('unsubscribe')) {
      var c2 = await kvGet(['subs'], who);
      await kvSet({ subs: (c2.subs || []).filter(function (s) { return s.sub.endpoint !== b.endpoint; }) }, who);
      return out(200, { ok: true });
    }
    if (q('prefs')) {
      var p = b.prefs || {}, clean = {
        minRet: Math.min(0.2, Math.max(0, +p.minRet || PREFS.minRet)), middles: p.middles !== false,
        places: ['all', 'ex', 'mine'].indexOf(p.places) >= 0 ? p.places : 'all', books: (Array.isArray(p.books) ? p.books : []).map(String).slice(0, 60) };
      await kvSet({ prefs: clean }, who);
      return out(200, { ok: true, prefs: clean });
    }
    if (q('test')) {
      var kt = await kvGet(['subs', 'vapid'], who);
      if (!(kt.subs || []).length) return out(400, { error: 'no devices have alerts turned on' });
      var r = await pushAll(await vapidOf(kt, who), kt.subs, { title: 'TDC Bet alerts are on', body: 'Test alert: new sure bets and no-lose middles for today\'s games will show up like this.', tag: 'arb-test' });
      if (r.keep.length !== kt.subs.length) await kvSet({ subs: r.keep }, who);
      return out(200, { sent: r.sent, errors: r.errors });
    }
    return out(400, { error: 'unknown request' });
  } catch (e) {
    var m = String(e.message || e);
    return out(/not allowed/.test(m) ? 403 : 500, { error: m.slice(0, 300) });
  }
};
