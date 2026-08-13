// Per-transfer social-preview injector. Reached ONLY by crawler user-agents (middleware.js);
// real visitors always get the static /transfer-fit.html untouched. Resolves the player's name,
// current team (destination) and hometown (transfer origin) from Supabase, uses the destination
// team's logo as the card image, and re-injects a per-transfer OG/Twitter set. Any error → page as-is.

var SB = 'https://izlqhnxowdhtdofkwrho.supabase.co';
var KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildHead(html, title, desc, url, image) {
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
  html = html.replace('<head>', '<head>' + block);
  html = html.replace(/<title>[\s\S]*?<\/title>/i, '<title>' + esc(title) + '</title>');
  return html;
}

module.exports = async function (req, res) {
  var proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  var host = req.headers['x-forwarded-host'] || req.headers.host || 'www.thedepthchartcbb.com';
  var base = proto + '://' + host;
  var q = req.query || {};
  var espn = (q.espn ? String(q.espn) : '').trim();
  var nameParam = (q.name ? String(q.name) : '').trim();

  var html = null;
  try {
    html = await (await fetch(base + '/transfer-fit.html', { headers: { 'user-agent': 'tdc-og-fetch' } })).text();
  } catch (e) { html = null; }

  if (!html) {
    var q0 = espn ? 'espn=' + encodeURIComponent(espn) : 'name=' + encodeURIComponent(nameParam);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<title>Transfer Fit Report — The Depth Chart</title>' +
      '<meta http-equiv="refresh" content="0;url=/transfer-fit.html?' + esc(q0) + '">' +
      '</head><body></body></html>'
    );
  }

  try {
    var pname = nameParam, team = '', origin = '';
    var qFilter = espn ? 'espn_id=eq.' + encodeURIComponent(espn) : 'name=eq.' + encodeURIComponent(nameParam);
    try {
      var rows = await (await fetch(
        SB + '/rest/v1/players?' + qFilter + '&select=name,team,hometown&limit=1',
        { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } }
      )).json();
      if (rows && rows[0]) { pname = rows[0].name || pname; team = rows[0].team || ''; origin = (rows[0].hometown || '').trim(); }
    } catch (e) { /* keep params */ }

    var title, desc, image = null;
    if (pname && team && origin) {
      title = pname + '’s Transfer Fit: ' + origin + ' → ' + team + ' — The Depth Chart';
      desc = 'How ' + pname + ' fits ' + team + ' — coach & system fit, projected 2026-27 line, and whether he’s set to take a leap. Transfer Fit Report on The Depth Chart.';
    } else if (pname) {
      title = pname + ' — Transfer Fit Report — The Depth Chart';
      desc = pname + '’s landing-spot breakdown: coach fit, system fit, projection and leap potential.';
    } else {
      title = 'Transfer Fit Report — The Depth Chart';
      desc = 'When a player transfers, a full breakdown of how he fits the new coach, team and system — plus projection and leap potential.';
    }
    if (team) {
      try {
        var teams = await (await fetch(base + '/scripts/data/team_colors.json')).json();
        var lc = team.toLowerCase();
        for (var i = 0; i < teams.length; i++) if ((teams[i].location || '').toLowerCase() === lc) { image = teams[i].logo || null; break; }
      } catch (e) { /* no image */ }
    }
    var qs = espn ? 'espn=' + encodeURIComponent(espn) : 'name=' + encodeURIComponent(nameParam);
    html = buildHead(html, title, desc, base + '/transfer-fit.html?' + qs, image);
  } catch (e) { /* leave html unmodified */ }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
  return res.status(200).send(html);
};
