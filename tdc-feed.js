/* ============================================================
   TDC FEED — a team's feed on the team page (owner, Oct 18 2026: "an article view just like Substack … look like Instagram …
   posts and articles … forums and videos linked from elsewhere … images, videos and charts from our site").

   One feed per team, built on the fan-site tables (scripts/fan_sites.sql + scripts/team_feed.sql):
     * POSTS    — Instagram-style: a caption (≤ 2,200) + up to 10 media blocks (photo uploads, LIVE site charts, video links)
     * ARTICLES — Substack-style long reads: title, dek, cover, Markdown body that can hold photos, charts and videos
     * FORUM    — the team's forum threads (forum_topics.team), shown in the same stream
   Feed ⇄ Grid toggle (IG home feed / IG profile grid), filter chips, likes (fan_likes), comments (fan_comments).
   Writers = the owner + that team's approved fan-site writers (fan_can_write); everyone signed in can like/comment.

   Media blocks (fan_articles.media, and `::chart` / `::video` lines inside an article body):
     {t:'img',   url}                         photo in the fan-media bucket (or any https image)
     {t:'video', url}                         YouTube / Shorts / Vimeo / X / TikTok / Instagram link → embedded player
     {t:'chart', c:'trend'|'shots'|'look', team, full, tid, season}   drawn LIVE from current data:
        trend = TDCTeamTrend (season trend line), shots = TDC_SHOTCHART Zones, look = TDC_SHOTCHART Look quality
   API: TDCFeed.render(host, { team:'Dayton', full:'Dayton Flyers', tid:2168, color:'#CE1141' })
============================================================ */
(function (g) {
  var SB = 'https://izlqhnxowdhtdofkwrho.supabase.co', KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
  var CHARTS = { trend: 'Season trend line', shots: 'Shot chart (zones)', look: 'Look quality (good vs bad shots)' };
  var SHOT_SEASON = 2026;   // newest season with shot locations; 2026-27 fills nightly from opening night

  // ── helpers ──
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var session = function () { try { return JSON.parse(localStorage.getItem('tdc_session') || 'null'); } catch (e) { return null; } };
  var tok = function () { var s = session(); return (s && s.access_token) || null; };
  var uid = function () { var s = session(); return (s && s.user && s.user.id) || null; };
  var isOwner = function () { try { return !!(g.tdcIsOwner && g.tdcIsOwner()); } catch (e) { return false; } };
  var H = function (auth) { return { apikey: KEY, Authorization: 'Bearer ' + ((auth && tok()) || KEY), 'Content-Type': 'application/json' }; };
  function errText(r) { return r.text().then(function (t) { if (r.status === 401) return 'Your session has expired — sign out and back in.'; try { var j = JSON.parse(t); if (j.message) return j.message; } catch (e) {} return 'Something went wrong (' + r.status + ').'; }); }
  function get(path, auth) { return fetch(SB + '/rest/v1/' + path, { headers: H(auth) }).then(function (r) { return r.ok ? r.json() : errText(r).then(function (m) { throw new Error(m); }); }); }
  function send(path, method, body, prefer) {
    var h = H(true); if (prefer) h.Prefer = prefer;
    return fetch(SB + '/rest/v1/' + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { if (!r.ok) return errText(r).then(function (m) { throw new Error(m); }); return r.status === 204 ? null : r.json().catch(function () { return null; }); });
  }
  var ago = function (d) { var s = Math.floor((Date.now() - new Date(d)) / 1000); if (s < 60) return 'now'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h'; if (s < 604800) return Math.floor(s / 86400) + 'd'; return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
  var dateLong = function (d) { return new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }); };
  var readMins = function (b) { return Math.max(1, Math.round(String(b || '').split(/\s+/).filter(Boolean).length / 230)); };
  var logo = function (tid) { return tid ? 'https://a.espncdn.com/i/teamlogos/ncaa/500/' + tid + '.png' : ''; };
  var LOADED = {};
  function loadScript(src) { if (!LOADED[src]) LOADED[src] = new Promise(function (ok) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = ok; document.head.appendChild(s); }); return LOADED[src]; }

  // ── video links → embeddable players (iframes only; no third-party scripts) ──
  function videoOf(url) {
    var u = String(url || '').trim(), m;
    if ((m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/i.exec(u))) return { kind: 'youtube', src: 'https://www.youtube-nocookie.com/embed/' + m[1], thumb: 'https://img.youtube.com/vi/' + m[1] + '/hqdefault.jpg', ratio: /shorts\//.test(u) ? '9/16' : '16/9' };
    if ((m = /vimeo\.com\/(?:video\/)?(\d+)/i.exec(u))) return { kind: 'vimeo', src: 'https://player.vimeo.com/video/' + m[1], ratio: '16/9' };
    if ((m = /(?:twitter|x)\.com\/[^\/]+\/status\/(\d+)/i.exec(u))) return { kind: 'x', src: 'https://platform.twitter.com/embed/Tweet.html?dnt=true&id=' + m[1] + '&theme=' + (dark() ? 'dark' : 'light'), h: 560 };
    if ((m = /tiktok\.com\/@[^\/]+\/video\/(\d+)/i.exec(u))) return { kind: 'tiktok', src: 'https://www.tiktok.com/embed/v2/' + m[1], ratio: '9/16' };
    if ((m = /instagram\.com\/(?:p|reel|reels)\/([\w-]+)/i.exec(u))) return { kind: 'instagram', src: 'https://www.instagram.com/p/' + m[1] + '/embed', h: 620 };
    return null;
  }
  function dark() { var t = document.documentElement.getAttribute('data-theme'); return t ? t === 'dark' : !!(g.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches); }
  function videoHtml(url) {
    var v = videoOf(url);
    if (!v) return /^https?:\/\//i.test(url) ? '<a class="fd-link" href="' + esc(url) + '" target="_blank" rel="noopener nofollow ugc">' + esc(url.replace(/^https?:\/\//, '').slice(0, 70)) + ' ↗</a>' : '';
    var box = v.ratio ? 'aspect-ratio:' + v.ratio + (v.ratio === '9/16' ? ';max-height:640px;margin:0 auto' : '') : 'height:' + v.h + 'px';
    return '<div class="fd-video" style="' + box + '"><iframe src="' + esc(v.src) + '" loading="lazy" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" title="' + v.kind + ' video"></iframe></div>';
  }

  // ── live site charts ──
  function chartHtml(b) { return '<div class="fd-chart" data-chart="' + esc(JSON.stringify(b)) + '"><div class="fd-chart-cap">' + esc(CHARTS[b.c] || 'Chart') + (b.team ? ' · ' + esc(b.team) : '') + '</div><div class="fd-chart-body"><div class="fd-muted">Loading chart…</div></div></div>'; }
  var SHOTS = {};
  function hydrate(root, full) {
    [].forEach.call(root.querySelectorAll('.fd-chart[data-chart]:not([data-done])'), function (el) {
      el.setAttribute('data-done', '1');
      var b; try { b = JSON.parse(el.getAttribute('data-chart')); } catch (e) { return; }
      var body = el.querySelector('.fd-chart-body');
      if (b.c === 'trend') {
        loadScript('tdc-teamtrend.js?v=9').then(function () { if (g.TDCTeamTrend) TDCTeamTrend.render(body, { full: b.full, short: b.team, color: b.color || null }); });
      } else if (b.c === 'shots' || b.c === 'look') {
        loadScript('tdc-shotchart.js?v=34').then(function () {
          var k = b.tid + '|' + (b.season || SHOT_SEASON);
          SHOTS[k] = SHOTS[k] || fetch(SB + '/rest/v1/shots?team_id=eq.' + b.tid + '&season_year=eq.' + (b.season || SHOT_SEASON) + '&select=x,y,made,sv,dist,game_id&limit=8000', { headers: g.tdcH ? tdcH() : H(true) }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; });
          SHOTS[k].then(function (rows) {
            if (!rows || rows.length < 40) { body.innerHTML = '<div class="fd-muted">' + (tok() ? 'Shot charts are part of Pro.' : 'Sign in with Pro to see this shot chart.') + '</div>'; return; }
            if (g.TDC_SHOTCHART) TDC_SHOTCHART.render(body, rows, { subtitle: b.team, kind: 'team', season: b.season || SHOT_SEASON, mode: b.c === 'look' ? 'look' : 'zones', compact: !full });
          });
        });
      }
    });
  }
  function blockHtml(b) { return !b ? '' : b.t === 'img' ? '<img class="fd-img" src="' + esc(b.url) + '" alt="' + esc(b.alt || '') + '" loading="lazy">' : b.t === 'video' ? videoHtml(b.url) : b.t === 'chart' ? chartHtml(b) : ''; }

  // ── article body: small, safe Markdown (escaped first) + block lines ──
  //   ![caption](https://…)   ::video <url>   ::chart trend|shots|look   (a bare video link on its own line embeds too)
  function inline(t) {
    return t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener nofollow ugc">$1</a>');
  }
  function renderBody(src, ctx) {
    var raw = String(src || '').replace(/\r/g, '').split('\n'), out = [], para = [], list = null, quote = [];
    var fP = function () { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } };
    var fL = function () { if (list) { out.push('<' + list.t + '>' + list.items.map(function (i) { return '<li>' + inline(i) + '</li>'; }).join('') + '</' + list.t + '>'); list = null; } };
    var fQ = function () { if (quote.length) { out.push('<blockquote>' + quote.map(inline).join('<br>') + '</blockquote>'); quote = []; } };
    var fl = function () { fP(); fL(); fQ(); };
    raw.forEach(function (r0) {
      var r = r0.trimEnd(), t = r.trim(), m, l = esc(r);
      if (!t) { fl(); return; }
      if ((m = /^::chart\s+(trend|shots|look)(?:\s+(\d{4}))?$/i.exec(t))) { fl(); out.push(chartHtml({ t: 'chart', c: m[1].toLowerCase(), team: ctx.team, full: ctx.full, tid: ctx.tid, color: ctx.color, season: m[2] ? +m[2] : null })); return; }
      if ((m = /^::video\s+(\S+)$/i.exec(t)) || (videoOf(t) && /^https?:\/\/\S+$/.test(t) && (m = [t, t]))) { fl(); out.push(videoHtml(m[1])); return; }
      if ((m = /^#{2,3}\s+(.+)$/.exec(l))) { fl(); var lv = /^###/.test(l) ? 3 : 2; out.push('<h' + lv + '>' + inline(m[1]) + '</h' + lv + '>'); return; }
      if (/^(-{3,}|\*{3,})$/.test(t)) { fl(); out.push('<hr>'); return; }
      if ((m = /^!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)$/.exec(esc(t)))) { fl(); out.push('<figure><img src="' + m[2] + '" alt="' + m[1] + '" loading="lazy">' + (m[1] ? '<figcaption>' + m[1] + '</figcaption>' : '') + '</figure>'); return; }
      if ((m = /^&gt;\s?(.*)$/.exec(l))) { fP(); fL(); quote.push(m[1]); return; }
      if ((m = /^\s*[-*]\s+(.+)$/.exec(l))) { fP(); fQ(); if (!list || list.t !== 'ul') { fL(); list = { t: 'ul', items: [] }; } list.items.push(m[1]); return; }
      if ((m = /^\s*\d+[.)]\s+(.+)$/.exec(l))) { fP(); fQ(); if (!list || list.t !== 'ol') { fL(); list = { t: 'ol', items: [] }; } list.items.push(m[1]); return; }
      fL(); fQ(); para.push(l);
    });
    fl(); return out.join('');
  }
  var linkify = function (t) { return esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener nofollow ugc">$1</a>').replace(/\n/g, '<br>'); };

  // ── the feed ──
  function render(host, o) {
    if (!host || !o || !o.team) return;
    var S = { view: 'feed', filter: 'all', posts: [], forum: [], likes: {}, mine: {}, ncom: {}, canWrite: false, editor: false, legacy: false };
    var col = o.color || 'var(--accent)';
    host.classList.add('fd-host');
    host.innerHTML = '<div class="fd-muted" style="padding:30px;text-align:center">Loading the feed…</div>';

    function role() {
      if (isOwner()) { S.canWrite = S.editor = true; return Promise.resolve(); }
      if (!uid()) return Promise.resolve();
      return get('fan_writers?team=eq.' + encodeURIComponent(o.team) + '&user_id=eq.' + uid() + '&select=role', true).then(function (r) { if (r && r[0]) { S.canWrite = true; S.editor = r[0].role === 'editor'; } }).catch(function () {});
    }
    function load() {
      var T = encodeURIComponent(o.team), cols = 'id,kind,title,dek,cover_url,body,media,author_id,author_name,published_at,status';
      var posts = get('fan_articles?team=eq.' + T + '&status=eq.published&select=' + cols + '&order=published_at.desc&limit=60')
        .catch(function () { S.legacy = true; return get('fan_articles?team=eq.' + T + '&status=eq.published&select=id,title,dek,cover_url,body,author_id,author_name,published_at&order=published_at.desc&limit=60').catch(function () { return []; }); });
      var forum = get('forum_topics?team=eq.' + T + '&select=id,title,body,author_name,reply_count,created_at&order=created_at.desc&limit=30').catch(function () { return []; });
      return Promise.all([posts, forum]).then(function (a) {
        S.posts = (a[0] || []).map(function (p) { p.kind = p.kind || 'article'; p.media = Array.isArray(p.media) ? p.media : []; return p; });
        S.forum = a[1] || [];
        var ids = S.posts.map(function (p) { return p.id; });
        if (!ids.length || S.legacy) return;
        return Promise.all([get('fan_likes?article_id=in.(' + ids.join(',') + ')&select=article_id,user_id').catch(function () { return []; }),
          get('fan_comments?article_id=in.(' + ids.join(',') + ')&select=article_id').catch(function () { return []; })]).then(function (b) {
          S.likes = {}; S.mine = {}; S.ncom = {};
          (b[0] || []).forEach(function (l) { S.likes[l.article_id] = (S.likes[l.article_id] || 0) + 1; if (l.user_id === uid()) S.mine[l.article_id] = true; });
          (b[1] || []).forEach(function (c) { S.ncom[c.article_id] = (S.ncom[c.article_id] || 0) + 1; });
        });
      });
    }
    function items() {
      var a = [];
      if (S.filter === 'all' || S.filter === 'article' || S.filter === 'post') S.posts.forEach(function (p) { if (S.filter === 'all' || S.filter === p.kind) a.push({ type: p.kind, at: p.published_at, p: p }); });
      if (S.filter === 'all' || S.filter === 'forum') S.forum.forEach(function (f) { a.push({ type: 'forum', at: f.created_at, f: f }); });
      return a.sort(function (x, y) { return new Date(y.at) - new Date(x.at); });
    }
    var forumHref = function (f) { return 'fan.html?team=' + encodeURIComponent(o.team) + '&tab=forum' + (f ? '&t=' + f.id : ''); };

    function head(p, kindLab) {
      return '<div class="fd-head"><span class="fd-av" style="border-color:' + col + '">' + (o.tid ? '<img src="' + logo(o.tid) + '" alt="">' : esc(o.team[0])) + '</span>' +
        '<div class="fd-who"><b>' + esc(p.author_name || o.team) + '</b><span>' + esc(o.team) + ' · ' + ago(p.published_at || p.created_at) + '</span></div>' +
        '<span class="fd-chip ' + kindLab.toLowerCase() + '">' + kindLab + '</span>' +
        (canEdit(p) ? '<button class="fd-more" data-act="menu" data-id="' + p.id + '" aria-label="Post options">⋯</button>' : '') + '</div>';
    }
    var canEdit = function (p) { return p && p.id && (S.editor || (S.canWrite && p.author_id === uid())); };
    function actions(p) {
      return '<div class="fd-acts"><button data-act="like" data-id="' + p.id + '" class="' + (S.mine[p.id] ? 'on' : '') + '" aria-label="Like">' + (S.mine[p.id] ? '♥' : '♡') + '</button>' +
        '<button data-act="open" data-id="' + p.id + '" aria-label="Comments">💬</button><button data-act="share" data-id="' + p.id + '" aria-label="Copy link">↗</button>' +
        '<span class="fd-cnt">' + (S.likes[p.id] ? '<b>' + S.likes[p.id] + '</b> like' + (S.likes[p.id] > 1 ? 's' : '') : '') + '</span></div>';
    }
    function card(it) {
      if (it.type === 'forum') { var f = it.f;
        return '<article class="fd-card fd-forum"><div class="fd-head"><span class="fd-av forum">💬</span><div class="fd-who"><b>' + esc(f.author_name || 'member') + '</b><span>Forum · ' + ago(f.created_at) + '</span></div><span class="fd-chip forum">Forum</span></div>' +
          '<a class="fd-forum-body" href="' + forumHref(f) + '"><b>' + esc(f.title) + '</b><span>' + esc(String(f.body || '').slice(0, 220)) + (String(f.body || '').length > 220 ? '…' : '') + '</span><em>' + (f.reply_count || 0) + ' repl' + (f.reply_count === 1 ? 'y' : 'ies') + ' · Join the thread →</em></a></article>'; }
      var p = it.p, nC = S.ncom[p.id] || 0;
      if (p.kind === 'article') {
        return '<article class="fd-card">' + head(p, 'Article') +
          '<button class="fd-art" data-act="open" data-id="' + p.id + '">' + (p.cover_url ? '<img class="fd-img" src="' + esc(p.cover_url) + '" alt="" loading="lazy">' : '<div class="fd-art-tint" style="background-color:' + col + '"><em>' + esc(o.team) + ' · Article</em><span>' + esc(p.title) + '</span></div>') + '</button>' +
          actions(p) + '<div class="fd-cap"><button class="fd-art-t" data-act="open" data-id="' + p.id + '">' + esc(p.title) + '</button>' + (p.dek ? '<p>' + esc(p.dek) + '</p>' : '') +
          '<span class="fd-read">Article · ' + readMins(p.body) + ' min read · <button data-act="open" data-id="' + p.id + '">Read →</button></span></div>' +
          (nC ? '<button class="fd-viewc" data-act="open" data-id="' + p.id + '">View all ' + nC + ' comment' + (nC > 1 ? 's' : '') + '</button>' : '') + '</article>';
      }
      var m = p.media.slice(0, 10), long = String(p.body || '').length > 220;
      return '<article class="fd-card">' + head(p, 'Post') +
        (m.length ? '<div class="fd-media" data-n="' + m.length + '"><div class="fd-track">' + m.map(function (b) { return '<div class="fd-slide">' + blockHtml(b) + '</div>'; }).join('') + '</div>' +
          (m.length > 1 ? '<button class="fd-nav prev" data-act="slide" data-d="-1" aria-label="Previous">‹</button><button class="fd-nav next" data-act="slide" data-d="1" aria-label="Next">›</button><div class="fd-dots">' + m.map(function (_, i) { return '<i class="' + (i ? '' : 'on') + '"></i>'; }).join('') + '</div>' : '') + '</div>' : '') +
        actions(p) + (p.body ? '<div class="fd-cap' + (long ? ' clamp' : '') + '"><b>' + esc(p.author_name || '') + '</b> ' + linkify(p.body) + '</div>' + (long ? '<button class="fd-viewc" data-act="more">more</button>' : '') : '') +
        (nC ? '<button class="fd-viewc" data-act="open" data-id="' + p.id + '">View all ' + nC + ' comment' + (nC > 1 ? 's' : '') + '</button>' : '') + '</article>';
    }
    function tile(it) {
      if (it.type === 'forum') return '<a class="fd-tile txt" href="' + forumHref(it.f) + '"><span class="fd-tchip">💬</span><b>' + esc(it.f.title) + '</b><em>' + (it.f.reply_count || 0) + ' replies</em></a>';
      var p = it.p, b0 = p.media[0], inner, badge = '';
      if (p.kind === 'article') { inner = p.cover_url ? '<img src="' + esc(p.cover_url) + '" alt="" loading="lazy"><span class="fd-ttl">' + esc(p.title) + '</span>' : '<div class="fd-art-tint" style="background-color:' + col + '"><span>' + esc(p.title) + '</span></div>'; badge = '📰'; }
      else if (b0 && b0.t === 'img') inner = '<img src="' + esc(b0.url) + '" alt="" loading="lazy">';
      else if (b0 && b0.t === 'video') { var v = videoOf(b0.url); inner = v && v.thumb ? '<img src="' + v.thumb + '" alt="" loading="lazy">' : '<div class="fd-tint2">' + esc((v && v.kind) || 'video') + '</div>'; badge = '▶'; }
      else if (b0 && b0.t === 'chart') { inner = '<div class="fd-tint2"><span class="fd-cico">📊</span>' + esc(CHARTS[b0.c] || 'Chart') + '</div>'; badge = '📊'; }
      else inner = '<div class="fd-tint2 txt">' + esc(String(p.body || '').slice(0, 120)) + '</div>';
      if (p.media.length > 1) badge = '❐';
      return '<button class="fd-tile" data-act="open" data-id="' + p.id + '">' + inner + (badge ? '<span class="fd-tchip">' + badge + '</span>' : '') + '<span class="fd-hover">♥ ' + (S.likes[p.id] || 0) + ' · 💬 ' + (S.ncom[p.id] || 0) + '</span></button>';
    }

    function paint() {
      var it = items(), F = [['all', 'All'], ['article', 'Articles'], ['post', 'Posts'], ['forum', 'Forum']];
      host.innerHTML = '<div class="fd-bar"><div class="fd-seg"><button data-act="view" data-v="feed" class="' + (S.view === 'feed' ? 'on' : '') + '">▤ Feed</button><button data-act="view" data-v="grid" class="' + (S.view === 'grid' ? 'on' : '') + '">▦ Grid</button></div>' +
        '<div class="fd-filters">' + F.map(function (f) { return '<button data-act="filter" data-f="' + f[0] + '" class="' + (S.filter === f[0] ? 'on' : '') + '">' + f[1] + '</button>'; }).join('') + '</div>' +
        '<div class="fd-new">' + (S.canWrite ? '<button class="fd-btn pri" data-act="compose" data-k="post" style="background:' + col + '">+ Post</button><button class="fd-btn" data-act="compose" data-k="article">✎ Article</button>' : '') +
        '<a class="fd-btn" href="' + forumHref(null) + '">💬 Forum</a></div></div>' +
        (S.legacy && S.canWrite ? '<div class="fd-note">Run <b>scripts/team_feed.sql</b> once in Supabase to turn on posts, likes and comments (articles already work).</div>' : '') +
        (it.length ? (S.view === 'grid' ? '<div class="fd-grid">' + it.map(tile).join('') + '</div>' : '<div class="fd-feed">' + it.map(card).join('') + '</div>')
          : '<div class="fd-empty"><b>Nothing here yet.</b><span>' + (S.canWrite ? 'Share the first post or article for ' + esc(o.team) + '.' : 'Posts, articles and forum threads about ' + esc(o.team) + ' will show up here.') + '</span></div>');
      hydrate(host, false);
    }

    // ── a single post / article, full screen ──
    function overlay(html) { close(); var d = document.createElement('div'); d.className = 'fd-ov'; d.innerHTML = '<div class="fd-ov-in">' + html + '</div>'; document.body.appendChild(d); document.body.classList.add('fd-lock');
      d.addEventListener('click', function (e) { if (e.target === d || (e.target.closest && e.target.closest('[data-act="close"]'))) { close(); setUrl(null); } }); d.addEventListener('click', onClick); return d; }
    function close() { [].forEach.call(document.querySelectorAll('.fd-ov'), function (x) { x.remove(); }); document.body.classList.remove('fd-lock'); }
    function setUrl(id) { try { var u = new URL(location.href); if (id) u.searchParams.set('post', id); else u.searchParams.delete('post'); history.replaceState(history.state, '', u.toString()); } catch (e) {} }
    function openPost(id) {
      var p = S.posts.find(function (x) { return String(x.id) === String(id); }); if (!p) return;
      setUrl(p.id);
      var com = '<div class="fd-coms" id="fdComs"><div class="fd-muted">Loading comments…</div></div>' +
        (S.legacy ? '' : uid() ? '<form class="fd-cform" data-id="' + p.id + '"><input maxlength="1000" placeholder="Add a comment…" aria-label="Add a comment"><button>Post</button></form>' : '<a class="fd-signin" href="signin.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search) + '">Sign in to like and comment</a>');
      var el;
      if (p.kind === 'article') {
        el = overlay('<button class="fd-x" data-act="close" aria-label="Close">✕</button><article class="fd-reader">' +
          '<div class="fd-kick" style="color:' + col + '">' + esc(o.team) + '</div><h1>' + esc(p.title) + '</h1>' + (p.dek ? '<p class="fd-dek">' + esc(p.dek) + '</p>' : '') +
          '<div class="fd-by"><span class="fd-av" style="border-color:' + col + '">' + (o.tid ? '<img src="' + logo(o.tid) + '" alt="">' : '') + '</span><div><b>' + esc(p.author_name || '') + '</b><span>' + dateLong(p.published_at) + ' · ' + readMins(p.body) + ' min read</span></div></div>' +
          actions(p) + (p.cover_url ? '<figure class="fd-cover"><img src="' + esc(p.cover_url) + '" alt=""></figure>' : '') +
          '<div class="fd-body">' + renderBody(p.body, { team: o.team, full: o.full, tid: o.tid, color: o.color }) + '</div>' + actions(p) +
          '<h3 class="fd-ch">Comments</h3>' + com + '</article>');
      } else {
        el = overlay('<button class="fd-x" data-act="close" aria-label="Close">✕</button><div class="fd-single">' + card({ type: 'post', p: p }) + '<h3 class="fd-ch">Comments</h3>' + com + '</div>');
        var cap = el.querySelector('.fd-cap.clamp'); if (cap) cap.classList.remove('clamp'); var mo = el.querySelector('[data-act="more"]'); if (mo) mo.remove();
      }
      hydrate(el, true); loadComments(p.id, el);
      var f = el.querySelector('.fd-cform'); if (f) f.onsubmit = function (e) { e.preventDefault(); var inp = f.querySelector('input'), t = inp.value.trim(); if (!t) return; inp.disabled = true;
        send('fan_comments', 'POST', { article_id: p.id, body: t }, 'return=minimal').then(function () { inp.value = ''; S.ncom[p.id] = (S.ncom[p.id] || 0) + 1; loadComments(p.id, el); })
          .catch(function (er) { alert(er.message); }).then(function () { inp.disabled = false; inp.focus(); }); };
    }
    function loadComments(id, el) {
      var box = el.querySelector('#fdComs'); if (!box) return;
      if (S.legacy) { box.innerHTML = '<div class="fd-muted">Comments turn on once scripts/team_feed.sql is run.</div>'; return; }
      get('fan_comments?article_id=eq.' + id + '&select=id,author_id,author_name,body,created_at&order=created_at.asc&limit=200').then(function (cs) {
        box.innerHTML = cs.length ? cs.map(function (c) { return '<div class="fd-com"><b>' + esc(c.author_name || 'member') + '</b> ' + linkify(c.body) + '<span>' + ago(c.created_at) + ((c.author_id === uid() || S.editor) ? ' · <button data-act="delc" data-id="' + c.id + '" data-p="' + id + '">delete</button>' : '') + '</span></div>'; }).join('') : '<div class="fd-muted">No comments yet — start the conversation.</div>';
      }).catch(function () { box.innerHTML = '<div class="fd-muted">Couldn’t load comments.</div>'; });
    }

    // ── composer (posts) and editor (articles) ──
    function upload(file) {
      if (!uid() || !tok()) return Promise.reject(new Error('Sign in first.'));
      if (file.size > 5 * 1024 * 1024) return Promise.reject(new Error('Images must be 5 MB or smaller.'));
      var path = uid() + '/' + Date.now() + '-' + file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-');
      return fetch(SB + '/storage/v1/object/fan-media/' + path, { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + tok(), 'Content-Type': file.type, 'x-upsert': 'false' }, body: file })
        .then(function (r) { if (!r.ok) return errText(r).then(function (m) { throw new Error(m); }); return SB + '/storage/v1/object/public/fan-media/' + path; });
    }
    var chartPick = function () { return '<select class="fd-in" data-role="chartsel">' + Object.keys(CHARTS).map(function (k) { return '<option value="' + k + '">' + CHARTS[k] + '</option>'; }).join('') + '</select>'; };
    var mkChart = function (c) { return { t: 'chart', c: c, team: o.team, full: o.full, tid: o.tid, color: o.color, season: c === 'trend' ? null : SHOT_SEASON }; };
    function compose(kind, p) {
      if (S.legacy && kind === 'post') { alert('Run scripts/team_feed.sql in Supabase first — it turns on posts.'); return; }
      var edit = !!p; p = p || { kind: kind, title: '', dek: '', body: '', cover_url: '', media: [] }; kind = p.kind || kind;
      var media = (p.media || []).slice();
      var el = overlay('<button class="fd-x" data-act="close" aria-label="Close">✕</button><div class="fd-comp">' +
        '<h2>' + (edit ? 'Edit ' : 'New ') + (kind === 'article' ? 'article' : 'post') + ' · ' + esc(o.team) + '</h2>' +
        (kind === 'article'
          ? '<input class="fd-in big" id="fcTitle" maxlength="140" placeholder="Headline" value="' + esc(p.title) + '"><input class="fd-in" id="fcDek" maxlength="280" placeholder="Subtitle (optional)" value="' + esc(p.dek || '') + '">' +
            '<div class="fd-row"><input class="fd-in" id="fcCover" placeholder="Cover image URL (optional)" value="' + esc(p.cover_url || '') + '"><button class="fd-btn" data-act="up-cover">Upload cover</button></div>' +
            '<div class="fd-tools"><button data-ins="**bold**">B</button><button data-ins="*italic*">I</button><button data-ins="\n## Heading\n">H2</button><button data-ins="\n> quote\n">❝</button><button data-ins="\n- item\n">•</button><button data-ins="[text](https://)">Link</button>' +
            '<button data-act="ins-img">📷 Photo</button>' + chartPick() + '<button data-act="ins-chart">📊 Insert chart</button><button data-act="ins-video">▶ Video link</button><button data-act="preview" class="fd-prevbtn">Preview</button></div>' +
            '<textarea class="fd-in fd-ta" id="fcBody" rows="16" placeholder="Write your story… Markdown works: **bold**, ## headings, > quotes, - lists. Photos, charts and videos go in with the buttons above.">' + esc(p.body || '') + '</textarea><div class="fd-body fd-prev" id="fcPrev" hidden></div>'
          : '<div class="fd-mlist" id="fcMedia"></div><div class="fd-tools"><button data-act="add-img">📷 Photo</button>' + chartPick() + '<button data-act="add-chart">📊 Add chart</button><button data-act="add-video">▶ Video link</button><span class="fd-muted" id="fcCount"></span></div>' +
            '<textarea class="fd-in fd-ta" id="fcBody" rows="5" maxlength="2200" placeholder="Write a caption…">' + esc(p.body || '') + '</textarea>') +
        '<input type="file" id="fcFile" accept="image/*" hidden><div class="fd-msg" id="fcMsg"></div>' +
        '<div class="fd-row end">' + (kind === 'article' ? '<button class="fd-btn" data-act="save" data-s="draft">Save draft</button>' : '') + '<button class="fd-btn pri" data-act="save" data-s="published" style="background:' + col + '">' + (edit && p.status === 'published' ? 'Update' : 'Publish') + '</button></div></div>');
      var $ = function (id) { return el.querySelector('#' + id); }, msg = function (t, bad) { var m = $('fcMsg'); m.textContent = t || ''; m.className = 'fd-msg' + (bad ? ' bad' : ''); };
      var fileFor = null;
      function drawMedia() { var box = $('fcMedia'); if (!box) return; box.innerHTML = media.map(function (b, i) { return '<div class="fd-mi">' + blockHtml(b) + '<button data-act="rm" data-i="' + i + '" aria-label="Remove">✕</button></div>'; }).join(''); hydrate(box, false); $('fcCount').textContent = media.length + ' / 10'; }
      drawMedia();
      var ta = $('fcBody');
      var insert = function (txt) { var a = ta.selectionStart || ta.value.length; ta.value = ta.value.slice(0, a) + txt + ta.value.slice(ta.selectionEnd || a); ta.focus(); ta.selectionStart = ta.selectionEnd = a + txt.length; };
      $('fcFile').onchange = function () { var f = this.files[0]; this.value = ''; if (!f) return; msg('Uploading…');
        upload(f).then(function (url) { msg('');
          if (fileFor === 'cover') $('fcCover').value = url; else if (fileFor === 'inline') insert('\n![](' + url + ')\n'); else { media.push({ t: 'img', url: url }); drawMedia(); } })
          .catch(function (e) { msg(e.message, true); }); };
      el.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('button'); if (!b || !el.contains(b)) return;
        if (b.hasAttribute('data-ins')) { e.preventDefault(); insert(b.getAttribute('data-ins').replace(/\\n/g, '\n')); return; }
        var a = b.getAttribute('data-act'), sel = el.querySelector('[data-role="chartsel"]');
        if (a === 'add-img' || a === 'ins-img' || a === 'up-cover') { e.preventDefault(); fileFor = a === 'up-cover' ? 'cover' : a === 'ins-img' ? 'inline' : 'media'; if (a === 'add-img' && media.length >= 10) return msg('Up to 10 items per post.', true); $('fcFile').click(); }
        if (a === 'add-chart') { e.preventDefault(); if (media.length >= 10) return msg('Up to 10 items per post.', true); media.push(mkChart(sel.value)); drawMedia(); }
        if (a === 'ins-chart') { e.preventDefault(); insert('\n::chart ' + sel.value + '\n'); }
        if (a === 'add-video' || a === 'ins-video') { e.preventDefault(); var u = prompt('Paste a YouTube, X, TikTok, Instagram or Vimeo link'); if (!u) return; u = u.trim();
          if (!/^https:\/\//i.test(u)) return msg('Use a full https:// link.', true);
          if (a === 'ins-video') insert('\n::video ' + u + '\n'); else { if (media.length >= 10) return msg('Up to 10 items per post.', true); media.push({ t: 'video', url: u }); drawMedia(); } }
        if (a === 'rm') { e.preventDefault(); media.splice(+b.getAttribute('data-i'), 1); drawMedia(); }
        if (a === 'preview') { e.preventDefault(); var pv = $('fcPrev'), on = pv.hidden; pv.hidden = !on; ta.hidden = on; b.textContent = on ? 'Edit' : 'Preview'; if (on) { pv.innerHTML = renderBody(ta.value, { team: o.team, full: o.full, tid: o.tid, color: o.color }); hydrate(pv, true); } }
        if (a === 'save') { e.preventDefault(); var st = b.getAttribute('data-s');
          var row = kind === 'article'
            ? { kind: 'article', title: $('fcTitle').value.trim(), dek: $('fcDek').value.trim() || null, cover_url: $('fcCover').value.trim() || null, body: ta.value, status: st }
            : { kind: 'post', title: null, body: ta.value.trim(), media: media, status: 'published' };
          if (S.legacy) { delete row.kind; delete row.media; }
          if (kind === 'post' && !row.body && !media.length) return msg('Add a photo, chart, video or caption.', true);
          if (kind === 'article' && row.title.length < 5) return msg('Headlines need at least 5 characters.', true);
          if (!edit) row.team = o.team;
          b.disabled = true; msg('Saving…');
          (edit ? send('fan_articles?id=eq.' + p.id, 'PATCH', row, 'return=minimal') : send('fan_articles', 'POST', row, 'return=minimal'))
            .then(function () { close(); setUrl(null); return load().then(paint); })
            .catch(function (er) { msg(er.message, true); b.disabled = false; }); }
      });
    }

    // ── clicks ──
    function onClick(e) {
      var b = e.target.closest && e.target.closest('[data-act]'); if (!b) return;
      var a = b.getAttribute('data-act'), id = b.getAttribute('data-id');
      if (a === 'view') { S.view = b.getAttribute('data-v'); paint(); }
      else if (a === 'filter') { S.filter = b.getAttribute('data-f'); paint(); }
      else if (a === 'compose') compose(b.getAttribute('data-k'));
      else if (a === 'open') openPost(id);
      else if (a === 'more') { var c = b.previousElementSibling; if (c) c.classList.remove('clamp'); b.remove(); }
      else if (a === 'slide') { var med = b.closest('.fd-media'), n = +med.getAttribute('data-n'), i = Math.max(0, Math.min(n - 1, (+med.getAttribute('data-i') || 0) + (+b.getAttribute('data-d'))));
        med.setAttribute('data-i', i); med.querySelector('.fd-track').style.transform = 'translateX(' + (-100 * i) + '%)'; [].forEach.call(med.querySelectorAll('.fd-dots i'), function (d, k) { d.className = k === i ? 'on' : ''; }); }
      else if (a === 'like') {
        if (S.legacy) return; if (!uid()) { location.href = 'signin.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search); return; }
        var on = !S.mine[id]; S.mine[id] = on; S.likes[id] = Math.max(0, (S.likes[id] || 0) + (on ? 1 : -1));
        [].forEach.call(document.querySelectorAll('[data-act="like"][data-id="' + id + '"]'), function (x) { x.classList.toggle('on', on); x.textContent = on ? '♥' : '♡'; var cnt = x.parentNode.querySelector('.fd-cnt'); if (cnt) cnt.innerHTML = S.likes[id] ? '<b>' + S.likes[id] + '</b> like' + (S.likes[id] > 1 ? 's' : '') : ''; });
        (on ? send('fan_likes', 'POST', { article_id: +id }, 'return=minimal') : send('fan_likes?article_id=eq.' + id + '&user_id=eq.' + uid(), 'DELETE')).catch(function (er) { alert(er.message); });
      }
      else if (a === 'share') { var u = new URL(location.href); u.searchParams.set('tab', 'feed'); u.searchParams.set('post', id);
        (navigator.clipboard ? navigator.clipboard.writeText(u.toString()) : Promise.reject()).then(function () { b.textContent = '✓'; setTimeout(function () { b.textContent = '↗'; }, 1400); }).catch(function () { prompt('Copy this link', u.toString()); }); }
      else if (a === 'menu') { var p = S.posts.find(function (x) { return String(x.id) === String(id); }); if (!p) return;
        var ch = prompt('Type EDIT to edit this ' + p.kind + ', or DELETE to remove it.'); if (!ch) return; ch = ch.trim().toUpperCase();
        if (ch === 'EDIT') compose(p.kind, p);
        else if (ch === 'DELETE' && confirm('Delete this ' + p.kind + ' for good?')) send('fan_articles?id=eq.' + p.id, 'DELETE').then(function () { return load().then(paint); }).catch(function (er) { alert(er.message); }); }
      else if (a === 'delc') { if (!confirm('Delete this comment?')) return; send('fan_comments?id=eq.' + id, 'DELETE').then(function () { var pid = b.getAttribute('data-p'); S.ncom[pid] = Math.max(0, (S.ncom[pid] || 1) - 1); loadComments(pid, b.closest('.fd-ov')); }).catch(function (er) { alert(er.message); }); }
    }
    host.addEventListener('click', onClick);

    role().then(load).then(function () {
      paint();
      var want = new URLSearchParams(location.search).get('post'); if (want) openPost(want);
    }).catch(function (e) { host.innerHTML = '<div class="fd-empty"><b>Couldn’t load the feed.</b><span>' + esc(e.message) + '</span></div>'; });
  }

  if (!document.getElementById('fd-styles')) {
    var st = document.createElement('style'); st.id = 'fd-styles';
    st.textContent =
      '.fd-host{max-width:620px;margin:0 auto;}.fd-muted{color:var(--text3);font-size:13px;}' +
      '.fd-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:14px;}.fd-seg{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--border);border-radius:9px;background:var(--bg2);}' +
      '.fd-seg button,.fd-filters button{font:700 12.5px Inter,system-ui,sans-serif;padding:7px 12px;border:none;background:none;color:var(--text2);cursor:pointer;}.fd-seg button{border-radius:7px;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--text3);padding:6px 12px;}.fd-seg button.on{background:var(--accent);color:var(--accent-on,#221c08);}' +
      '.fd-filters{display:flex;gap:4px;flex-wrap:wrap;}.fd-filters button{border-radius:999px;border:1px solid var(--border);}.fd-filters button.on{background:var(--text);border-color:var(--text);color:var(--bg);}' +
      '.fd-new{margin-left:auto;display:flex;gap:6px;}.fd-btn{font:700 12.5px Inter,system-ui,sans-serif;padding:7px 12px;border-radius:8px;border:1px solid var(--border2);background:var(--bg2);color:var(--text);cursor:pointer;text-decoration:none;white-space:nowrap;}' +
      '.fd-btn.pri{color:#fff;border-color:transparent;}.fd-btn:disabled{opacity:.5;}' +
      '.fd-note{font-size:12.5px;color:var(--text2);background:var(--bg2);border:1px dashed var(--border2);border-radius:8px;padding:9px 12px;margin-bottom:12px;}' +
      '.fd-empty{display:flex;flex-direction:column;gap:6px;align-items:center;text-align:center;padding:46px 16px;border:1px dashed var(--border2);border-radius:14px;color:var(--text3);font-size:13px;}.fd-empty b{color:var(--text);font-size:15px;}' +
      '.fd-feed{display:flex;flex-direction:column;gap:18px;}.fd-card{border:1px solid var(--border);border-radius:14px;background:var(--bg);overflow:hidden;}' +
      '.fd-head{display:flex;align-items:center;gap:10px;padding:10px 12px;}.fd-av{width:36px;height:36px;border-radius:50%;border:2px solid var(--border2);background:#fff;display:inline-flex;align-items:center;justify-content:center;flex:none;overflow:hidden;font-weight:800;}' +
      '.fd-av img{width:80%;height:80%;object-fit:contain;}.fd-av.forum{background:var(--bg2);font-size:16px;}.fd-who{display:flex;flex-direction:column;min-width:0;line-height:1.2;}.fd-who b{font-size:13.5px;color:var(--text);}.fd-who span{font-size:11.5px;color:var(--text3);}' +
      '.fd-chip{margin-left:auto;font:800 9.5px Inter,system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;padding:3px 7px;border-radius:999px;border:1px solid var(--border2);color:var(--text2);}' +
      '.fd-more{border:none;background:none;color:var(--text2);font-size:18px;cursor:pointer;padding:0 4px;}' +
      '.fd-media{position:relative;overflow:hidden;background:var(--bg2);}.fd-track{display:flex;transition:transform .25s ease;}.fd-slide{flex:0 0 100%;min-width:0;}' +
      '.fd-img{display:block;width:100%;height:auto;max-height:720px;object-fit:cover;}.fd-nav{position:absolute;top:50%;transform:translateY(-50%);width:30px;height:30px;border-radius:50%;border:none;background:rgba(255,255,255,.85);color:#111;font-size:18px;cursor:pointer;}' +
      '.fd-nav.prev{left:8px;}.fd-nav.next{right:8px;}.fd-dots{position:absolute;bottom:8px;left:0;right:0;display:flex;justify-content:center;gap:4px;}.fd-dots i{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.5);}.fd-dots i.on{background:#fff;}' +
      '.fd-video{position:relative;width:100%;background:#000;}.fd-video iframe{position:absolute;inset:0;width:100%;height:100%;border:0;}' +
      '.fd-chart{padding:10px 12px;background:var(--bg);}.fd-chart-cap{font:800 10.5px Inter,system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);margin-bottom:6px;}' +
      '.fd-card .tt-ctl,.fd-mi .tt-ctl{display:none;}.fd-card .tt-foot input{display:none;}' +
      '.fd-link{display:block;padding:14px;color:var(--text);font-weight:700;word-break:break-all;}' +
      '.fd-acts{display:flex;align-items:center;gap:4px;padding:8px 8px 2px;}.fd-acts button{border:none;background:none;font-size:21px;line-height:1;cursor:pointer;color:var(--text);padding:4px 6px;}.fd-acts button.on{color:#e0245e;}' +
      '.fd-cnt{margin-left:auto;font-size:12.5px;color:var(--text2);padding-right:6px;}.fd-cnt b{color:var(--text);}' +
      '.fd-cap{padding:4px 14px 6px;font-size:14px;line-height:1.5;color:var(--text);}.fd-cap.clamp{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}.fd-cap p{margin:4px 0 0;color:var(--text2);font-size:13.5px;}' +
      '.fd-cap a,.fd-com a{color:var(--text);text-decoration:underline;}.fd-viewc{display:block;border:none;background:none;color:var(--text3);font-size:13px;padding:0 14px 12px;cursor:pointer;text-align:left;}' +
      '.fd-art{display:block;width:100%;border:none;padding:0;background:none;cursor:pointer;}.fd-art-tint{aspect-ratio:16/9;display:flex;flex-direction:column;justify-content:flex-end;gap:8px;padding:22px 24px;color:#fff;text-align:left;background-image:linear-gradient(160deg,rgba(255,255,255,.12),rgba(0,0,0,.38));}.fd-art-tint em{font:800 10.5px Inter,system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;font-style:normal;opacity:.85;}' +
      '.fd-art-tint span{font:800 26px/1.15 "Playfair Display",Georgia,serif;text-shadow:0 1px 10px rgba(0,0,0,.25);}.fd-art-t{border:none;background:none;padding:0;text-align:left;cursor:pointer;font:800 20px/1.2 "Playfair Display",Georgia,serif;color:var(--text);}' +
      '.fd-read{display:block;margin-top:6px;font-size:12px;color:var(--text3);}.fd-read button{border:none;background:none;color:var(--text);font-weight:800;cursor:pointer;padding:0;}' +
      '.fd-forum-body{display:flex;flex-direction:column;gap:6px;padding:4px 14px 14px;text-decoration:none;color:var(--text);}.fd-forum-body b{font-size:16px;}.fd-forum-body span{font-size:13.5px;color:var(--text2);line-height:1.45;}.fd-forum-body em{font-style:normal;font-size:12px;font-weight:700;color:var(--text3);}' +
      '.fd-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:3px;}.fd-tile{position:relative;aspect-ratio:1;overflow:hidden;border:none;padding:0;background:var(--bg2);cursor:pointer;display:block;text-decoration:none;color:var(--text);}' +
      '.fd-tile img{width:100%;height:100%;object-fit:cover;display:block;}.fd-tile .fd-art-tint{aspect-ratio:auto;height:100%;padding:10px;}.fd-tile .fd-art-tint span{font-size:14px;}' +
      '.fd-ttl{position:absolute;left:0;right:0;bottom:0;padding:16px 8px 7px;background:linear-gradient(transparent,rgba(0,0,0,.7));color:#fff;font:800 12px/1.2 "Playfair Display",Georgia,serif;text-align:left;}' +
      '.fd-tint2{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:8px;font:700 12px Inter,system-ui,sans-serif;color:var(--text2);text-align:center;}.fd-tint2.txt{font-weight:500;font-size:11.5px;}.fd-cico{font-size:26px;}' +
      '.fd-tile.txt{display:flex;flex-direction:column;justify-content:center;gap:4px;padding:10px;text-align:left;}.fd-tile.txt b{font-size:12.5px;line-height:1.25;}.fd-tile.txt em{font-style:normal;font-size:11px;color:var(--text3);}' +
      '.fd-tchip{position:absolute;top:6px;right:7px;font-size:13px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5));}.fd-hover{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);color:#fff;font-weight:800;font-size:13px;opacity:0;transition:opacity .15s;}' +
      '.fd-tile:hover .fd-hover{opacity:1;}' +
      '.fd-ov{position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.6);overflow-y:auto;-webkit-overflow-scrolling:touch;}.fd-ov-in{position:relative;max-width:760px;margin:28px auto;background:var(--bg);border-radius:16px;padding:18px 18px 28px;min-height:200px;}' +
      'body.fd-lock{overflow:hidden;}.fd-x{position:sticky;top:0;float:right;z-index:2;width:34px;height:34px;border-radius:50%;border:1px solid var(--border2);background:var(--bg);color:var(--text);font-size:15px;cursor:pointer;}' +
      '.fd-single .fd-card{border:none;}' +
      '.fd-reader{max-width:640px;margin:0 auto;padding-top:8px;}.fd-kick{font:800 11px Inter,system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;}' +
      '.fd-reader h1{font:800 clamp(30px,5vw,42px)/1.12 "Playfair Display",Georgia,serif;letter-spacing:-.01em;margin:8px 0 10px;color:var(--text);}.fd-dek{font:400 20px/1.45 Georgia,serif;color:var(--text2);margin:0 0 16px;}' +
      '.fd-by{display:flex;align-items:center;gap:10px;padding:12px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border);}.fd-by div{display:flex;flex-direction:column;line-height:1.3;}.fd-by b{font-size:14px;color:var(--text);}.fd-by span{font-size:12.5px;color:var(--text3);}' +
      '.fd-cover{margin:18px 0;}.fd-cover img{width:100%;border-radius:4px;}' +
      '.fd-body{font:400 19px/1.75 Georgia,"Times New Roman",serif;color:var(--text);}.fd-body p{margin:0 0 1.15em;}.fd-body h2{font:800 26px/1.25 "Playfair Display",Georgia,serif;margin:1.4em 0 .5em;}.fd-body h3{font:800 21px/1.3 "Playfair Display",Georgia,serif;margin:1.2em 0 .4em;}' +
      '.fd-body blockquote{margin:1.2em 0;padding:2px 0 2px 18px;border-left:3px solid var(--text);font-style:italic;color:var(--text2);}.fd-body figure{margin:1.4em 0;}.fd-body figure img{width:100%;border-radius:4px;}.fd-body figcaption{font:13px Inter,system-ui,sans-serif;color:var(--text3);margin-top:6px;text-align:center;}' +
      '.fd-body .fd-chart,.fd-body .fd-video{margin:1.4em 0;border-radius:8px;}.fd-body .fd-chart{font-family:Inter,system-ui,sans-serif;}.fd-body .fd-chart{border:1px solid var(--border);font-size:13px;line-height:1.4;}.fd-body a{color:var(--text);}.fd-body hr{border:none;border-top:1px solid var(--border);margin:2em 0;}' +
      '.fd-ch{font:800 12px Inter,system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);margin:22px 0 8px;}' +
      '.fd-coms{display:flex;flex-direction:column;gap:10px;}.fd-com{font-size:14px;line-height:1.45;color:var(--text);}.fd-com span{display:block;font-size:11.5px;color:var(--text3);}.fd-com button{border:none;background:none;color:var(--text3);font-size:11.5px;cursor:pointer;padding:0;text-decoration:underline;}' +
      '.fd-cform{display:flex;gap:8px;margin-top:12px;border-top:1px solid var(--border);padding-top:12px;}.fd-cform input{flex:1;min-width:0;font:15px Inter,system-ui,sans-serif;padding:9px 11px;border:1px solid var(--border2);border-radius:999px;background:var(--bg2);color:var(--text);}' +
      '.fd-cform button{border:none;background:none;font-weight:800;color:var(--text);cursor:pointer;}.fd-signin{display:block;margin-top:12px;font-weight:700;color:var(--text);}' +
      '.fd-comp h2{font:800 22px "Playfair Display",Georgia,serif;margin:4px 0 14px;color:var(--text);}.fd-in{display:block;width:100%;box-sizing:border-box;font:15px Inter,system-ui,sans-serif;padding:10px 12px;border:1px solid var(--border2);border-radius:9px;background:var(--bg2);color:var(--text);margin-bottom:10px;}' +
      '.fd-in.big{font:800 22px "Playfair Display",Georgia,serif;}.fd-ta{font:16px/1.6 Georgia,serif;resize:vertical;}.fd-row{display:flex;gap:8px;align-items:flex-start;}.fd-row .fd-in{flex:1;}.fd-row.end{justify-content:flex-end;margin-top:6px;}' +
      '.fd-tools{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:10px;}.fd-tools button{font:700 12.5px Inter,system-ui,sans-serif;padding:6px 10px;border:1px solid var(--border2);border-radius:7px;background:var(--bg);color:var(--text);cursor:pointer;}' +
      '.fd-tools select.fd-in{width:auto;margin:0;padding:6px 8px;font-size:12.5px;}.fd-prevbtn{margin-left:auto;}.fd-prev{border:1px dashed var(--border2);border-radius:9px;padding:14px 16px;margin-bottom:10px;}' +
      '.fd-mlist{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:10px;}.fd-mi{position:relative;border:1px solid var(--border);border-radius:9px;overflow:hidden;max-height:260px;}.fd-mi .fd-chart{transform:scale(.98);}' +
      '.fd-mi>button{position:absolute;top:6px;right:6px;z-index:3;width:26px;height:26px;border-radius:50%;border:none;background:rgba(0,0,0,.65);color:#fff;cursor:pointer;}' +
      '.fd-comp [hidden]{display:none!important;}.fd-msg{font-size:13px;color:var(--text2);min-height:18px;}.fd-msg.bad{color:#d24a3b;}' +
      '@media(max-width:640px){.fd-new{margin-left:0;width:100%;}.fd-new .fd-btn{flex:1;text-align:center;}.fd-ov-in{margin:0;border-radius:0;min-height:100vh;padding:14px 14px 40px;}.fd-body{font-size:18px;}.fd-mlist{grid-template-columns:minmax(0,1fr);}}';
    document.head.appendChild(st);
  }
  g.TDCFeed = { render: render, renderBody: renderBody, videoOf: videoOf };
})(window);
