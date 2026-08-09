// Edge Middleware — runs BEFORE the filesystem, so it can intercept /team.html and
// /player.html even though those static files exist (plain vercel.json rewrites cannot).
// It ONLY acts on crawler user-agents, redirecting them to the OG-injection functions so
// shared links unfurl with the real team/player. Every other request (real visitors, and
// the functions' own plain-UA fetch) falls straight through to the static file. Wrapped in
// try/catch that continues on any error, so it can never break the page for a human.

export const config = { matcher: ['/team.html', '/player.html'] };

var CRAWLER = /facebookexternalhit|Facebot|Twitterbot|Slackbot|Slack-ImgProxy|Discordbot|WhatsApp|LinkedInBot|TelegramBot|Pinterest|redditbot|Googlebot|bingbot|Applebot|SkypeUriPreview|vkShare|Embedly|Iframely|Bluesky|Mastodon|WordPress/i;

export default function middleware(request) {
  try {
    var ua = request.headers.get('user-agent') || '';
    if (!CRAWLER.test(ua)) return;                 // not a crawler → continue to the static file
    var url = new URL(request.url);
    url.pathname = url.pathname === '/player.html' ? '/api/og-player' : '/api/og-team';
    return Response.redirect(url.toString(), 307); // crawler → OG-injection function (query preserved)
  } catch (e) {
    return;                                         // anything unexpected → serve the page normally
  }
}
