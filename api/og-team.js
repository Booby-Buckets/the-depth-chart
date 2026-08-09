// Per-team social-preview injector.
// Only CRAWLER user-agents are rewritten here (see vercel.json "rewrites"); real visitors
// always get the untouched static team.html, so nothing here can break the page for humans.
// We fetch the static page with a plain UA (which is NOT matched by the crawler rewrite, so
// there is no routing loop), swap in per-team Open Graph / Twitter / <title>, and return it.
// On ANY error we return the static page unchanged (worst case: preview falls back to the
// site default — the pre-existing behavior).

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function setMeta(html, attr, key, value) {
  var v = esc(value);
  var re = new RegExp('(<meta\\s+' + attr + '="' + key + '"\\s+content=")[^"]*(">)', 'i');
  if (re.test(html)) return html.replace(re, '$1' + v + '$2');
  // not present -> inject right after <head>
  return html.replace('<head>', '<head>\n  <meta ' + attr + '="' + key + '" content="' + v + '">');
}

module.exports = async function (req, res) {
  var proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  var host = req.headers['x-forwarded-host'] || req.headers.host || 'www.thedepthchartcbb.com';
  var base = proto + '://' + host;
  var team = (req.query && req.query.team ? String(req.query.team) : '').trim();

  var html = null;
  try {
    // plain fetch => default UA => NOT crawler => rewrite does not fire => static file, no loop
    var r = await fetch(base + '/team.html', { headers: { 'user-agent': 'tdc-og-fetch' } });
    html = await r.text();
  } catch (e) { html = null; }

  if (!html) {
    // Could not read the page at all — send a minimal preview so the crawler still gets something.
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<title>The Depth Chart — College Basketball Analytics</title>' +
      '<meta property="og:title" content="The Depth Chart — College Basketball Analytics">' +
      '<meta property="og:description" content="Advanced college basketball roster rankings, team & player analytics, and 2026-27 projections.">' +
      '<meta http-equiv="refresh" content="0;url=/team.html?team=' + esc(encodeURIComponent(team)) + '">' +
      '</head><body></body></html>'
    );
  }

  try {
    var title, desc, image;
    if (team) {
      var teams = [];
      try { teams = await (await fetch(base + '/scripts/data/team_colors.json')).json(); } catch (e) { teams = []; }
      var lc = team.toLowerCase();
      var t = null;
      for (var i = 0; i < teams.length; i++) {
        var loc = (teams[i].location || '').toLowerCase();
        if (loc === lc) { t = teams[i]; break; }
      }
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
      image = null;
    }

    html = setMeta(html, 'property', 'og:title', title);
    html = setMeta(html, 'name', 'twitter:title', title);
    html = setMeta(html, 'property', 'og:description', desc);
    html = setMeta(html, 'name', 'twitter:description', desc);
    html = setMeta(html, 'property', 'og:url', base + '/team.html?team=' + encodeURIComponent(team));
    if (image) {
      html = setMeta(html, 'property', 'og:image', image);
      html = setMeta(html, 'name', 'twitter:image', image);
      html = setMeta(html, 'name', 'twitter:card', 'summary_large_image');
    }
    html = html.replace(/<title>[\s\S]*?<\/title>/i, '<title>' + esc(title) + '</title>');
  } catch (e) {
    // leave html unmodified — the static default OG still applies
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
  return res.status(200).send(html);
};
