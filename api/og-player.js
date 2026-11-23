// Player page for crawlers — search engines AND link-preview bots (middleware.js rewrites crawler requests for
// /player.html here; real visitors always get the static /player.html untouched, and the URL never changes).
//
// Nov 12 2026 (owner: "when I look up Braeden Shrewsberry his player page shows up in the search engine like ESPN or
// College Basketball Reference"): besides the share-card OG tags it now writes in what the app normally draws with
// JavaScript, so a crawler sees the real page —
//   <title> "Braeden Shrewsberry Stats, Height & Position – Notre Dame | The Depth Chart", meta description,
//   canonical (player.html?espn=ID), schema.org ProfilePage/Person JSON-LD, and a summary + season-by-season stats
//   table at the top of <body> (the same numbers the page shows people).
// Resolved from Supabase by espn_id (public anon key). Any error → the page is returned as-is.
// CDN-cached for a day per URL (s-maxage), so a crawl costs one function run per player per day at most.

var SB = 'https://izlqhnxowdhtdofkwrho.supabase.co';
var KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
var SITE = 'https://www.thedepthchartcbb.com';
var HDR = { apikey: KEY, Authorization: 'Bearer ' + KEY };

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function getJSON(url) {
  return fetch(url, { headers: HDR }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; });
}
var POS = { PG: 'point guard', SG: 'shooting guard', G: 'guard', SF: 'small forward', PF: 'power forward', F: 'forward', C: 'center', 'G/F': 'wing', 'F/C': 'big', 'F/G': 'wing' };
var YR = { 'Fr.': 'freshman', 'So.': 'sophomore', 'Jr.': 'junior', 'Sr.': 'senior', 'Gr.': 'graduate', 'R-Fr.': 'redshirt freshman', 'R-So.': 'redshirt sophomore', 'R-Jr.': 'redshirt junior', 'R-Sr.': 'redshirt senior' };
// big site data files (projections, NIL prices), kept for an hour in the warm function so a crawl burst reads them once
var _cache = {};
function siteJSON(base, path) {
  var c = _cache[path];
  if (c && Date.now() - c.t < 3600e3) return c.p;
  var p = fetch(base + '/' + path).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  _cache[path] = { t: Date.now(), p: p }; return p;
}
function money(m) { return m >= 1 ? '$' + (+m).toFixed(1) + 'M' : '$' + Math.round(m * 1000) + 'K'; }
function seasonLbl(y) { y = +y; return (y - 1) + '-' + String(y).slice(2); }
function num(v, d) { return v == null || v === '' || !isFinite(+v) ? '—' : (+v).toFixed(d == null ? 1 : d); }

function buildHead(html, o) {
  // drop the page's generic tags, then write the player's own
  ['og:title', 'og:description', 'og:image', 'og:url', 'twitter:title', 'twitter:description', 'twitter:image', 'twitter:card'].forEach(function (k) {
    html = html.replace(new RegExp('[ \\t]*<meta\\s+(?:property|name)="' + k + '"[^>]*>\\r?\\n?', 'gi'), '');
  });
  html = html.replace(/[ \t]*<meta\s+name="description"[^>]*>\r?\n?/gi, '');
  html = html.replace(/[ \t]*<link\s+rel="canonical"[^>]*>\r?\n?/gi, '');
  var block =
    '\n  <meta name="description" content="' + esc(o.desc) + '">' +
    '\n  <link rel="canonical" href="' + esc(o.url) + '">' +
    '\n  <meta property="og:type" content="profile">' +
    '\n  <meta property="og:title" content="' + esc(o.ogTitle) + '">' +
    '\n  <meta name="twitter:title" content="' + esc(o.ogTitle) + '">' +
    '\n  <meta property="og:description" content="' + esc(o.desc) + '">' +
    '\n  <meta name="twitter:description" content="' + esc(o.desc) + '">' +
    '\n  <meta property="og:url" content="' + esc(o.url) + '">' +
    (o.image ? '\n  <meta property="og:image" content="' + esc(o.image) + '">\n  <meta name="twitter:image" content="' + esc(o.image) + '">' : '') +
    '\n  <meta name="twitter:card" content="summary">' +
    (o.ld ? '\n  <script type="application/ld+json">' + JSON.stringify(o.ld).replace(/</g, '\\u003c') + '</script>' : '');
  html = html.replace('<head>', '<head>' + block);
  html = html.replace(/<title>[\s\S]*?<\/title>/i, '<title>' + esc(o.title) + '</title>');
  if (o.body) html = html.replace(/<body([^>]*)>/i, function (m) { return m + o.body; });
  return html;
}

module.exports = async function (req, res) {
  var proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  var host = req.headers['x-forwarded-host'] || req.headers.host || 'www.thedepthchartcbb.com';
  var base = proto + '://' + host;
  var q = req.query || {};
  var espn = (q.espn ? String(q.espn) : '').replace(/[^0-9]/g, '');
  var nameParam = (q.name ? String(q.name) : '').trim();

  var html = null;
  try { html = await (await fetch(base + '/player.html', { headers: { 'user-agent': 'tdc-og-fetch' } })).text(); } catch (e) { html = null; }
  if (!html) {
    var q0 = espn ? 'espn=' + encodeURIComponent(espn) : 'name=' + encodeURIComponent(nameParam);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Player Profile — The Depth Chart</title>' +
      '<meta http-equiv="refresh" content="0;url=/player.html?' + esc(q0) + '"></head><body></body></html>');
  }

  try {
    var cur = null, hist = [], live = [];
    if (espn) {
      var r = await Promise.all([
        getJSON(SB + '/rest/v1/players?espn_id=eq.' + espn + '&select=name,team,position,class_year,yr,height,weight&limit=1'),
        getJSON(SB + '/rest/v1/player_history?espn_id=eq.' + espn + '&select=season_year,team,name,position,yr,height,weight,gp,mpg,ppg,rpg,apg,fg_pct,tp_pct,ft_pct&order=season_year.asc'),
        getJSON(SB + '/rest/v1/box_scores?espn_id=eq.' + espn + '&season_year=eq.2027&select=team,min,pts,reb,ast,fgm,fga,tpm,tpa,ftm,fta')
      ]);
      cur = (r[0] && r[0][0]) || null; hist = r[1] || []; live = (r[2] || []).filter(function (b) { return +b.min > 0; });
      var extra = await Promise.all([siteJSON(base, 'scripts/data/stat_overall_projected.json'), siteJSON(base, 'data/nil_production.json')]);
      var proj = extra[0] && extra[0].players ? extra[0].players[espn] : null, nil = extra[1] && extra[1].exp ? extra[1].exp[espn] : null;
    }
    if (typeof proj === 'undefined') { var proj = null, nil = null; }
    var last = hist.length ? hist[hist.length - 1] : null;
    var pname = (cur && cur.name) || (last && last.name) || nameParam;
    var team = (cur && cur.team) || (last && last.team) || '';
    var canon = SITE + '/player.html?' + (espn ? 'espn=' + espn : 'name=' + encodeURIComponent(nameParam));
    var o;
    if (!pname) {
      o = { title: 'Player Profile — The Depth Chart', ogTitle: 'Player Profile — The Depth Chart', url: canon,
        desc: 'College basketball player stats, projections, grades, comps and scouting on The Depth Chart.' };
    } else {
      var ht = (cur && cur.height) || (last && last.height) || '';
      var posK = (cur && cur.position) || (last && last.position) || '', pos = POS[posK] || '';
      var yrK = (cur && (cur.class_year || cur.yr)) || (last && last.yr) || '', yr = YR[yrK] || '';
      var who = [ht, yr, pos].filter(Boolean).join(' ');
      // the season line people search for: this season so far when he has played, else his latest full season
      var line = '';
      if (live.length) {
        var t = { pts: 0, reb: 0, ast: 0, tpm: 0, tpa: 0 }; live.forEach(function (b) { for (var k in t) t[k] += +b[k] || 0; });
        var g = live.length;
        line = '2026-27: ' + num(t.pts / g) + ' PPG, ' + num(t.reb / g) + ' RPG, ' + num(t.ast / g) + ' APG' + (t.tpa >= 5 ? ', ' + num(100 * t.tpm / t.tpa) + ' 3P%' : '') + ' in ' + g + (g === 1 ? ' game' : ' games');
      } else if (last && last.ppg != null) {
        line = seasonLbl(last.season_year) + ': ' + num(last.ppg) + ' PPG, ' + num(last.rpg) + ' RPG, ' + num(last.apg) + ' APG' + (last.tp_pct != null ? ', ' + num(last.tp_pct) + ' 3P%' : '');
      }
      var wt = (cur && cur.weight) || (nil && nil.wt) || null;
      for (var hi = hist.length - 1; !wt && hi >= 0; hi--) if (hist[hi].weight) wt = hist[hi].weight;
      wt = wt && +wt >= 120 ? Math.round(+wt) : null;
      var nilVal = nil && nil.val > 0 ? money(nil.val) : null;
      var title = pname + ' Stats, Height' + (nilVal ? ' & NIL Value' : ' & Position') + (team ? ' – ' + team : '') + ' | The Depth Chart';
      var desc = pname + (who || team ? ': ' + (who ? who : 'player') + (wt ? ', ' + wt + ' lb' : '') + (team ? ' for ' + team : '') + '.' : '.') + (line ? ' ' + line + '.' : '') +
        (nilVal ? ' Expected NIL value ' + nilVal + '.' : '') + ' Career stats, game logs, shot chart, 2026-27 projection and scouting report.';
      // teammates (links between player pages are how search engines find and weigh them)
      var mates = team ? await getJSON(SB + '/rest/v1/players?team=eq.' + encodeURIComponent(team) + '&espn_id=not.is.null&select=name,espn_id,position&order=depth_order.asc.nullslast,id.asc&limit=20') : [];
      mates = (mates || []).filter(function (m) { return String(m.espn_id) !== espn; });
      // the team's logo as the preview image (player headshots are shown to the owner only — never publish them here)
      var image = null;
      if (team) {
        try {
          var teams = await (await fetch(base + '/scripts/data/team_colors.json')).json(), lc = team.toLowerCase();
          for (var i = 0; i < teams.length; i++) if ((teams[i].location || '').toLowerCase() === lc) { image = teams[i].logo || null; break; }
        } catch (e) { /* no image */ }
      }
      var ld = { '@context': 'https://schema.org', '@type': 'ProfilePage', url: canon, name: title,
        mainEntity: { '@type': 'Person', name: pname, url: canon,
          jobTitle: 'College basketball ' + (pos || 'player'),
          height: ht ? ht.replace('-', "' ") + '"' : undefined,
          weight: wt ? { '@type': 'QuantitativeValue', value: wt, unitCode: 'LBR' } : undefined,
          memberOf: team ? { '@type': 'SportsTeam', name: team, sport: 'Basketball', url: SITE + '/team.html?team=' + encodeURIComponent(team) } : undefined,
          sameAs: espn ? ['https://www.espn.com/mens-college-basketball/player/_/id/' + espn] : undefined } };
      // what the page shows people, written into the HTML: who he is + every season on file
      var rows = hist.filter(function (h) { return h.ppg != null; }).map(function (h) {
        return '<tr><td>' + esc(seasonLbl(h.season_year)) + '</td><td><a href="/team.html?team=' + encodeURIComponent(h.team) + '">' + esc(h.team) + '</a></td><td>' + esc(h.gp != null ? h.gp : '—') + '</td><td>' + num(h.mpg) + '</td><td>' + num(h.ppg) +
          '</td><td>' + num(h.rpg) + '</td><td>' + num(h.apg) + '</td><td>' + num(h.fg_pct) + '</td><td>' + num(h.tp_pct) + '</td><td>' + num(h.ft_pct) + '</td></tr>';
      }).join('');
      var body = '\n<section id="tdc-seo" style="max-width:1100px;margin:16px auto;padding:0 16px;font:14px/1.5 Inter,system-ui,sans-serif;">' +
        '<h1>' + esc(pname) + '</h1>' +
        '<p>' + esc(pname) + (who || team ? ' is a ' + esc(who || 'player') + (team ? ' for <a href="/team.html?team=' + encodeURIComponent(team) + '">' + esc(team) + '</a>' : '') + '.' : '.') + (line ? ' ' + esc(line) + '.' : '') + '</p>' +
        (ht || wt ? '<p>How tall is ' + esc(pname) + '? ' + esc(pname) + ' is listed at ' + esc([ht, wt ? wt + ' lb' : ''].filter(Boolean).join(', ')) + (yr ? ' and is a ' + esc(yr) : '') + '.</p>' : '') +
        (proj && proj.ppg != null ? '<h2>' + esc(pname) + ' 2026-27 projection</h2><p>We project ' + esc(pname) + ' for ' + num(proj.ppg) + ' points, ' + num(proj.rpg) + ' rebounds and ' + num(proj.apg) + ' assists per game in ' + num(proj.mpg) + ' minutes' + (proj.tp_pct != null ? ', shooting ' + num(proj.tp_pct) + '% from three' : '') + '.</p>' : '') +
        (nilVal ? '<h2>' + esc(pname) + ' NIL value</h2><p>Expected NIL value: <b>' + nilVal + '</b>, priced on production: ' + (nil.wa >= 0 ? '+' : '') + num(nil.wa) + ' projected Wins Added over a season at ' + num(nil.mpg) + ' minutes, adjusted for the strength of his league and matched to the NIL market. An estimate, not a reported deal.</p>' : '') +
        (rows ? '<h2>' + esc(pname) + ' career stats</h2><table><thead><tr><th>Season</th><th>Team</th><th>GP</th><th>MPG</th><th>PPG</th><th>RPG</th><th>APG</th><th>FG%</th><th>3P%</th><th>FT%</th></tr></thead><tbody>' + rows + '</tbody></table>' : '') +
        (mates.length ? '<h2>' + esc(team) + ' teammates</h2><ul>' + mates.map(function (m) { return '<li><a href="/player.html?espn=' + encodeURIComponent(m.espn_id) + '">' + esc(m.name) + '</a>' + (m.position ? ' (' + esc(m.position) + ')' : '') + '</li>'; }).join('') + '</ul>' : '') +
        '</section>\n';
      o = { title: title, ogTitle: pname + (team ? ' · ' + team : '') + ' — The Depth Chart', desc: desc, url: canon, image: image, ld: ld, body: body };
    }
    html = buildHead(html, o);
  } catch (e) { /* leave html unmodified */ }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // browsers 10 min, Vercel's CDN a day (one function run per player per day), stale for a week while it refreshes
  res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=86400, stale-while-revalidate=604800');
  return res.status(200).send(html);
};
