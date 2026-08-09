// Per-team social-preview injector. Reached ONLY by crawler user-agents (middleware.js
// redirects them here); real visitors always get the static /team.html untouched. We fetch
// the static page with a plain UA (not a crawler → middleware ignores it → no loop), then
// strip + re-inject a clean set of OG/Twitter tags. Any error → return the page unchanged.

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Remove any existing managed meta tags, then inject one clean set (avoids duplicates).
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
    var title, desc, image = null;
    if (team) {
      var teams = [];
      try { teams = await (await fetch(base + '/scripts/data/team_colors.json')).json(); } catch (e) { teams = []; }
      var lc = team.toLowerCase(), t = null;
      for (var i = 0; i < teams.length; i++) if ((teams[i].location || '').toLowerCase() === lc) { t = teams[i]; break; }
      if (!t) for (var j = 0; j < teams.length; j++) {
        if ((teams[j].location || '').toLowerCase().indexOf(lc) === 0 || (teams[j].display || '').toLowerCase().indexOf(lc) === 0) { t = teams[j]; break; }
      }
      var name = (t && (t.display || t.location)) || team;
      title = name + ' — College Basketball Analytics · The Depth Chart';
      desc = name + ' 2026-27 roster ranking, team & player analytics, projections, and NIL values on The Depth Chart.';
      image = t && t.logo ? t.logo : null;
    } else {
      title = 'Team Analytics — The Depth Chart';
      desc = 'Advanced college basketball team analytics, roster rankings, and 2026-27 projections.';
    }
    html = buildHead(html, title, desc, base + '/team.html?team=' + encodeURIComponent(team), image);
  } catch (e) { /* leave html unmodified */ }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
  return res.status(200).send(html);
};
