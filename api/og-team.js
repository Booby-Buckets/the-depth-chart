// Per-team social-preview injector. Reached ONLY by crawler user-agents (middleware.js
// redirects them here); real visitors always get the static /team.html untouched. We fetch
// the static page with a plain UA (not a crawler → middleware ignores it → no loop), then
// strip + re-inject a clean set of OG/Twitter tags. Any error → return the page unchanged.

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

var SB = 'https://izlqhnxowdhtdofkwrho.supabase.co';
var KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
var SITE = 'https://www.thedepthchartcbb.com';
function getJSON(url) {
  return fetch(url, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; });
}
function num(v) { return v == null || v === '' || !isFinite(+v) ? '—' : (+v).toFixed(1); }

// Remove any existing managed meta tags, then inject one clean set (avoids duplicates).
function buildHead(html, title, desc, url, image, body) {
  var keys = ['og:title', 'og:description', 'og:image', 'og:url', 'twitter:title', 'twitter:description', 'twitter:image', 'twitter:card'];
  keys.forEach(function (k) {
    html = html.replace(new RegExp('[ \\t]*<meta\\s+(?:property|name)="' + k + '"[^>]*>\\r?\\n?', 'gi'), '');
  });
  var img = image
    ? '\n  <meta property="og:image" content="' + esc(image) + '">' +
      '\n  <meta name="twitter:image" content="' + esc(image) + '">' +
      '\n  <meta name="twitter:card" content="summary">'
    : '\n  <meta name="twitter:card" content="summary">';
  var block =
    '\n  <meta property="og:title" content="' + esc(title) + '">' +
    '\n  <meta name="twitter:title" content="' + esc(title) + '">' +
    '\n  <meta property="og:description" content="' + esc(desc) + '">' +
    '\n  <meta name="twitter:description" content="' + esc(desc) + '">' +
    '\n  <meta property="og:url" content="' + esc(url) + '">' + img;
  html = html.replace(/[ \t]*<meta\s+name="description"[^>]*>\r?\n?/gi, '');
  html = html.replace(/[ \t]*<link\s+rel="canonical"[^>]*>\r?\n?/gi, '');
  block = '\n  <meta name="description" content="' + esc(desc) + '">\n  <link rel="canonical" href="' + esc(url) + '">' + block;
  html = html.replace('<head>', '<head>' + block);
  // Nov 22 2026 (owner: player pages higher in search): the roster as plain links at the top of <body>, so every player page
  // is linked from its team page — the strongest internal link a player page gets
  if (body) html = html.replace(/<body([^>]*)>/i, function (m) { return m + body; });
  html = html.replace(/<title>[\s\S]*?<\/title>/i, '<title>' + esc(title) + '</title>');
  return html;
}

module.exports = async function (req, res) {
  var proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  var host = req.headers['x-forwarded-host'] || req.headers.host || 'www.thedepthchartcbb.com';
  var base = proto + '://' + host;
  var team = (req.query && req.query.team ? String(req.query.team) : '').trim();

  var html = null;
  try {
    html = await (await fetch(base + '/team.html', { headers: { 'user-agent': 'tdc-og-fetch' } })).text();
  } catch (e) { html = null; }

  if (!html) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<title>The Depth Chart — College Basketball Analytics</title>' +
      '<meta http-equiv="refresh" content="0;url=/team.html?team=' + esc(encodeURIComponent(team)) + '">' +
      '</head><body></body></html>'
    );
  }

  try {
    var title, desc, image = null, body = '';
    if (team) {
      var teams = [];
      try { teams = await (await fetch(base + '/scripts/data/team_colors.json')).json(); } catch (e) { teams = []; }
      var lc = team.toLowerCase(), t = null;
      for (var i = 0; i < teams.length; i++) if ((teams[i].location || '').toLowerCase() === lc) { t = teams[i]; break; }
      if (!t) for (var j = 0; j < teams.length; j++) {
        if ((teams[j].location || '').toLowerCase().indexOf(lc) === 0 || (teams[j].display || '').toLowerCase().indexOf(lc) === 0) { t = teams[j]; break; }
      }
      var name = (t && (t.display || t.location)) || team;
      var key = (t && t.location) || team;
      title = name + ' Roster, Stats & 2026-27 Projections | The Depth Chart';
      image = t && t.logo ? t.logo : null;
      var ros = await getJSON(SB + '/rest/v1/players?team=eq.' + encodeURIComponent(key) + '&select=name,espn_id,position,class_year,height,ppg,rpg,apg&order=depth_order.asc.nullslast,id.asc&limit=25');
      ros = (ros || []).filter(function (p) { return p && p.name; });
      desc = name + ' 2026-27 roster' + (ros.length ? ' (' + ros.slice(0, 3).map(function (p) { return p.name; }).join(', ') + (ros.length > 3 ? ' and more' : '') + ')' : '') + ', player stats, projections, rankings and NIL values on The Depth Chart.';
      if (ros.length) {
        body = '\n<section id="tdc-seo" style="max-width:1100px;margin:16px auto;padding:0 16px;font:14px/1.5 Inter,system-ui,sans-serif;">' +
          '<h1>' + esc(name) + ' roster 2026-27</h1><table><thead><tr><th>Player</th><th>Pos</th><th>Class</th><th>Ht</th><th>PPG 2025-26</th><th>RPG</th><th>APG</th></tr></thead><tbody>' +
          ros.map(function (p) {
            var nm = p.espn_id ? '<a href="/player.html?espn=' + encodeURIComponent(p.espn_id) + '">' + esc(p.name) + '</a>' : '<a href="/player.html?name=' + encodeURIComponent(p.name) + '&team=' + encodeURIComponent(key) + '">' + esc(p.name) + '</a>';
            return '<tr><td>' + nm + '</td><td>' + esc(p.position || '') + '</td><td>' + esc(p.class_year || '') + '</td><td>' + esc(p.height || '') + '</td><td>' + num(p.ppg) + '</td><td>' + num(p.rpg) + '</td><td>' + num(p.apg) + '</td></tr>';
          }).join('') + '</tbody></table></section>\n';
      }
    } else {
      title = 'Team Analytics — The Depth Chart';
      desc = 'Advanced college basketball team analytics, roster rankings, and 2026-27 projections.';
    }
    html = buildHead(html, title, desc, SITE + '/team.html?team=' + encodeURIComponent(team), image, body);
  } catch (e) { /* leave html unmodified */ }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
  return res.status(200).send(html);
};
