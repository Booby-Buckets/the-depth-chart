// Edge Middleware — runs BEFORE the filesystem, so it can intercept /team.html and
// /player.html even though those static files exist (plain vercel.json rewrites cannot).
// It ONLY acts on crawler user-agents, redirecting them to the OG-injection functions so
// shared links unfurl with the real team/player. Every other request (real visitors, and
// the functions' own plain-UA fetch) falls straight through to the static file. Wrapped in
// try/catch that continues on any error, so it can never break the page for a human.

export const config = { matcher: ['/team.html', '/player.html', '/transfer-fit.html'] };

// Broad but safe: generic markers ("bot", "crawl", "preview", …) never appear in real
// desktop/mobile browser UAs (Chrome/Safari/Firefox/Edge), so humans still fall through to
// the fast static path — while validators and any platform not named explicitly get the card.
// Deliberately NOT matched: "slack"/"discord"/"telegram"/"fban" in-app webviews (real humans);
// their crawlers end in "bot" and are caught by that. The functions' fetch UA ('tdc-og-fetch')
// contains none of these tokens, so the internal fetch never loops.
var CRAWLER = /bot|crawl|spider|scrape|unfurl|preview|screenshot|snippet|validat|headlesschrome|lighthouse|inspectiontool|prerender|facebookexternalhit|whatsapp|slack-imgproxy|skypeuripreview|vkshare|embedly|iframely|bluesky|mastodon|wordpress|opengraph/i;

export default function middleware(request) {
  try {
    var ua = request.headers.get('user-agent') || '';
    if (!CRAWLER.test(ua)) return;                 // not a crawler → continue to the static file
    var url = new URL(request.url);
    url.pathname = url.pathname === '/player.html' ? '/api/og-player'
                 : url.pathname === '/transfer-fit.html' ? '/api/og-transfer'
                 : '/api/og-team';
    return Response.redirect(url.toString(), 307); // crawler → OG-injection function (query preserved)
  } catch (e) {
    return;                                         // anything unexpected → serve the page normally
  }
}
