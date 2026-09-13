/* tdc-badge.js — the ONE member badge, sitewide.
   TDC_BADGE.html(profile, opts) → '' | seal | check-dot
     • plan premium / pro / coach  → the animated star-seal (gold→pink; pro = blue→violet;
                                     coach = green→gold) with a tooltip naming the tier
     • verified (no paid plan)     → the plain accent check dot
   opts: { size:'1em'|'20px', ml:'3px' }.  Injects its own CSS once. Works with the profile row
   shape every page already fetches (plan, verified). Load anywhere after <body> or in <head>. */
window.TDC_BADGE = (function () {
  var TIER = {
    premium: { label: 'Premium member', a: '#E6D5A8', b: '#FF4D9D', glow: 'rgba(255,77,157,.85)' },
    pro:     { label: 'Pro member',     a: '#7FB2FF', b: '#8E5CFF', glow: 'rgba(142,92,255,.85)' },
    coach:   { label: "Coach's Tier",   a: '#5AB875', b: '#E6D5A8', glow: 'rgba(90,184,117,.85)' }
  };
  var cssDone = false, seq = 0;
  function css() {
    if (cssDone || !document.head) return; cssDone = true;
    var s = document.createElement('style'); s.id = 'tdc-badge-css';
    s.textContent =
      '.tdc-prem{display:inline-flex;width:1em;height:1em;flex-shrink:0;vertical-align:-0.12em;cursor:default;margin-left:3px;}' +
      '.tdc-prem svg{width:100%;height:100%;overflow:visible;}' +
      '.tdc-prem .tv-seal{transform-origin:50% 50%;transform-box:fill-box;filter:drop-shadow(0 1px 4px rgba(230,213,168,.5));}' +
      '.tdc-prem .tv-check{stroke-dasharray:16;stroke-dashoffset:0;}' +
      '@keyframes tvSpin{to{transform:rotate(360deg);}}' +
      '@keyframes tvDraw{0%{stroke-dashoffset:16;}100%{stroke-dashoffset:0;}}' +
      '@keyframes tvPulse{0%,100%{filter:drop-shadow(0 1px 4px rgba(230,213,168,.5));}50%{filter:drop-shadow(0 1px 10px var(--tvglow,rgba(255,77,157,.85)));}}' +
      '.tdc-prem:hover .tv-seal{animation:tvSpin .7s cubic-bezier(.34,1.3,.5,1), tvPulse .7s ease;}' +
      '.tdc-prem:hover .tv-check{animation:tvDraw .5s .18s both;}' +
      '@media (prefers-reduced-motion: reduce){.tdc-prem:hover .tv-seal,.tdc-prem:hover .tv-check{animation:none;}}' +
      '.tdc-vdot{display:inline-flex;align-items:center;justify-content:center;width:1em;height:1em;background:var(--accent,#E6D5A8);border-radius:50%;flex-shrink:0;vertical-align:-0.12em;margin-left:3px;}' +
      '.tdc-vdot svg{width:58%;height:58%;fill:#fff;}';
    document.head.appendChild(s);
  }
  function tierOf(p) { var pl = p && (p.plan || '').toLowerCase(); return TIER[pl] ? pl : null; }
  function html(p, opts) {
    css(); opts = opts || {};
    var st = (opts.size ? 'width:' + opts.size + ';height:' + opts.size + ';' : '') + (opts.ml ? 'margin-left:' + opts.ml + ';' : '');
    var t = tierOf(p);
    if (t) {
      var T = TIER[t], id = 'tvg' + (++seq);
      return '<span class="tdc-prem" title="' + T.label + '" style="--tvglow:' + T.glow + ';' + st + '"><svg viewBox="0 0 24 24"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + T.a + '"/><stop offset="1" stop-color="' + T.b + '"/></linearGradient></defs>' +
        '<path class="tv-seal" fill="url(#' + id + ')" d="M12 1.6l3.09 6.26 6.91 1-5 4.87 1.18 6.88L12 17.4l-6.18 3.48L7 13.73l-5-4.87 6.91-1z"/>' +
        '<path class="tv-check" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" d="M8.7 11.9l2.2 2.2 4.3-4.7"/></svg></span>';
    }
    if (p && p.verified) return '<span class="tdc-vdot" title="Verified" style="' + st + '"><svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></span>';
    return '';
  }
  function label(p) { var t = tierOf(p); return t ? (t === 'coach' ? "Coach's Tier" : t.charAt(0).toUpperCase() + t.slice(1)) : (p && p.verified ? 'Verified' : 'Free'); }
  return { html: html, label: label, tierOf: tierOf, TIER: TIER };
})();
