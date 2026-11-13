// /sitemap-players.xml (vercel.json rewrite → here): every player page Google should know about, built from Supabase on
// request and CDN-cached for a day (Nov 12 2026, owner: player pages should show up in search like ESPN's).
// Who's in it: everyone on a current roster (players) + everyone with a season on file since 2023-24 (player_history),
// keyed by ESPN id → https://www.thedepthchartcbb.com/player.html?espn=<id> (the canonical the player page declares).
// Served as a function instead of a committed file so it stays current without a site deploy.

var SB = 'https://izlqhnxowdhtdofkwrho.supabase.co';
var KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
var SITE = 'https://www.thedepthchartcbb.com';
var HDR = { apikey: KEY, Authorization: 'Bearer ' + KEY };

// page through a table on a stable ORDER BY (unordered pages skip / repeat rows), several pages at a time
async function ids(table, filter) {
  var out = [], size = 1000;
  for (var start = 0; start < 60000; start += size * 6) {
    var pages = await Promise.all([0, 1, 2, 3, 4, 5].map(function (k) {
      return fetch(SB + '/rest/v1/' + table + '?select=espn_id&espn_id=not.is.null' + filter + '&order=espn_id.asc,id.asc&limit=' + size + '&offset=' + (start + k * size), { headers: HDR })
        .then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; });
    }));
    var got = 0;
    pages.forEach(function (p) { (p || []).forEach(function (r) { out.push(r.espn_id); }); got += (p || []).length; });
    if (got < size * 6) break;
  }
  return out;
}

module.exports = async function (req, res) {
  try {
    var r = await Promise.all([ids('players', ''), ids('player_history', '&season_year=gte.2024')]);
    var seen = {}, list = [];
    r[0].concat(r[1]).forEach(function (id) { id = String(id).replace(/[^0-9]/g, ''); if (id && !seen[id]) { seen[id] = 1; list.push(id); } });
    var xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      list.map(function (id) { return '  <url><loc>' + SITE + '/player.html?espn=' + id + '</loc><changefreq>weekly</changefreq></url>'; }).join('\n') +
      '\n</urlset>\n';
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).send(xml);
  } catch (e) {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    return res.status(500).send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
  }
};
