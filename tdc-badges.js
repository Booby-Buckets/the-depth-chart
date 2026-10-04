// tdc-badges.js — SAVED FOR LATER (Oct 2026). The player-badge engine that used to
// render a "Badges" box on player.html's Overview (and hero badge shields/medals).
// Pulled off the player page at the owner's request and parked here for a future
// project. NOT loaded by any page yet. Moved verbatim from player.html, so it still
// expects that page's globals when called: `player` (current player row) and
// `_skillSrcFor(val)` (returns {src, projected, label} for the viewed season).
// Entry points: computeBadges(p, src, meta) -> {cats, badges, total, basis};
// buildBadgesSection(p, B) -> HTML; buildBadgeShield / buildBadgeMedal / buildBadgeShields(B).
// Styles: tdc-badges.css.
// ── PLAYER BADGES ──────────────────────────────────────────
// 2K-inspired but original: skills a player has EARNED from real production.
// Tiers (weak→strong): Prospect · Starter · Star · All-American. Every badge is
// data-driven off position-aware D1 thresholds — nothing is assigned by hand.
// Tier colours: game-rarity scale (legendary / epic / rare / common).
var BADGE_TIERS=[
  {min:86,name:'All-American',color:'#FFB020',bg:'rgba(255,176,32,.15)', pips:4},
  {min:73,name:'Star',        color:'#A78BFA',bg:'rgba(167,139,250,.15)',pips:3},
  {min:58,name:'Starter',     color:'#5B8DEF',bg:'rgba(91,141,239,.15)', pips:2},
  {min:45,name:'Prospect',    color:'#7f8896',bg:'rgba(127,136,150,.15)',pips:1}
];
function _badgeTier(score){ for(var i=0;i<BADGE_TIERS.length;i++){ if(score>=BADGE_TIERS[i].min) return BADGE_TIERS[i]; } return null; }
// computeBadges(p, src, meta): grade the stat line `src` (a projected line or a
// specific season row) using the player's position. meta={projected,label}
// controls the basis caption, so badges recompute per viewed season.
function computeBadges(p, src, meta){
  meta=meta||{};
  function _n(o,k){var v=parseFloat(o&&o[k]);return isNaN(v)?0:v;}
  var s=src||p;
  var ppg=_n(s,'ppg'),rpg=_n(s,'rpg'),apg=_n(s,'apg'),mpg=_n(s,'mpg');
  var fg=_n(s,'fg_pct'),tp=_n(s,'tp_pct'),ft=_n(s,'ft_pct');
  var stl=_n(s,'stl'),blk=_n(s,'blk'),tovs=_n(s,'tovs');
  var oreb=_n(s,'oreb'),dreb=_n(s,'dreb'),tpm=_n(s,'tpm'),tpa=_n(s,'tpa'),fta=_n(s,'fta'),fga=_n(s,'fga');
  var pos=p.position||'G';
  var isGuard=pos==='PG'||pos==='SG'||pos==='CG'||pos==='G';
  var isBig=pos==='C'||pos==='PF'||pos==='FC';
  var sc=function(v,pts){ v=parseFloat(v)||0; for(var i=0;i<pts.length;i++){ if(v>=pts[i][0]) return pts[i][1]; } return pts[pts.length-1][1]; };
  var clamp=function(x){return Math.round(Math.max(0,Math.min(100,x)));};
  // component scales (0-100), position-aware
  var fgS   = sc(fg,[[58,94],[54,84],[50,74],[47,62],[44,52],[41,42],[0,24]]);
  var ftaVol= sc(fta,[[6,94],[4.5,82],[3.3,70],[2.3,58],[1.5,46],[0,26]]);
  var ftaRt = sc(fga>0?fta/fga:0,[[0.5,92],[0.4,80],[0.32,68],[0.25,56],[0.18,44],[0,26]]);
  var orebS = sc(oreb,[[3,94],[2.2,82],[1.6,70],[1.1,58],[0.7,46],[0,26]]);
  var ppgS  = sc(ppg,[[20,96],[16,86],[13,74],[10,62],[7,50],[0,28]]);
  var threeP= tp>0?sc(tp,[[42,96],[39,86],[37,74],[35,62],[33,50],[31,40],[0,22]]):18;
  var threeV= sc(tpm,[[3,94],[2.3,82],[1.7,70],[1.2,58],[0.7,46],[0,24]]);
  var tpaV  = sc(tpa,[[8,94],[6.5,84],[5,72],[3.8,60],[2.7,48],[0,24]]);
  var ftS   = ft>0?sc(ft,[[90,95],[85,86],[80,74],[75,62],[70,50],[0,28]]):40;
  var apgS  = isGuard?sc(apg,[[6,95],[4.5,84],[3.3,72],[2.3,60],[1.5,48],[0,26]])
                     :sc(apg,[[4,95],[3,84],[2.2,72],[1.5,60],[1,48],[0,28]]);
  var atoR  = sc(apg/Math.max(0.5,tovs),[[3,92],[2.3,80],[1.8,68],[1.4,56],[1.1,44],[0,28]]);
  // ball security: lower TOs = better, but only counts once a player handles the ball
  var secure = (apg>=1.2||mpg>=15) ? (tovs<=0.9?90:tovs<=1.3?80:tovs<=1.7?68:tovs<=2.3?56:tovs<=2.9?44:30) : 0;
  var blkS  = isBig?sc(blk,[[2.2,96],[1.6,86],[1.1,74],[0.8,62],[0.5,50],[0,28]])
                   :sc(blk,[[1,94],[0.6,82],[0.4,68],[0.25,54],[0,30]]);
  var stlS  = sc(stl,[[2,96],[1.5,86],[1.1,74],[0.8,62],[0.6,50],[0.4,40],[0,24]]);
  var rebS  = isBig?sc(rpg,[[10,96],[8,86],[6.5,74],[5,62],[4,50],[0,28]])
             :isGuard?sc(rpg,[[5,94],[4,82],[3.2,70],[2.5,58],[1.9,46],[0,26]])
                     :sc(rpg,[[7,94],[5.5,82],[4.5,72],[3.5,60],[2.7,48],[0,26]]);
  var disrupt=sc(stl+blk,[[3.2,96],[2.4,86],[1.8,74],[1.3,62],[0.9,50],[0,26]]);
  var engine = clamp(sc(ppg+1.2*apg,[[26,96],[20,86],[16,74],[12,62],[9,50],[0,28]]));

  // catalog — each: category, name, desc, score, and a gate (min volume to qualify)
  var CAT={FIN:'Finishing',SHO:'Shooting',PLY:'Playmaking',DEF:'Defense & Rebounding'};
  var defs=[
    {c:'FIN',n:'Rim Finisher',d:'Converts efficiently around the basket.',s:fgS,gate:fga>=4},
    {c:'FIN',n:'Contact Absorber',d:'Lives at the line and finishes through contact.',s:clamp(0.55*ftaVol+0.45*ftaRt),gate:fta>=1.5},
    {c:'FIN',n:'Second-Chance Threat',d:'Crashes the offensive glass for putbacks.',s:orebS,gate:oreb>=0.7},
    {c:'FIN',n:'Downhill Driver',d:'An aggressive slasher who pressures the rim.',s:clamp(0.6*ppgS+0.4*ftaVol),gate:ppg>=8&&fta>=2},
    {c:'SHO',n:'Sniper',d:'A high-volume shooter who connects from deep.',s:clamp(0.55*threeP+0.45*threeV),gate:tpa>=2},
    {c:'SHO',n:'Pure Stroke',d:'An elite-percentage three-point shooter.',s:threeP,gate:tpa>=2.5},
    {c:'SHO',n:'Free-Throw Merchant',d:'Automatic from the charity stripe.',s:ftS,gate:fta>=1.5},
    {c:'SHO',n:'Floor Spacer',d:'Bends the defense with heavy three-point volume.',s:tpaV,gate:tpa>=3},
    {c:'PLY',n:'Court General',d:'Runs the offense and sets up teammates.',s:apgS,gate:apg>=2},
    {c:'PLY',n:'Dime Machine',d:'A high-assist creator who takes care of the ball.',s:clamp(0.6*apgS+0.4*atoR),gate:apg>=3},
    {c:'PLY',n:'Sure Hands',d:'Rarely turns it over for his role.',s:secure,gate:(apg>=1.2||mpg>=15)},
    {c:'PLY',n:'Offensive Engine',d:'Carries a heavy scoring-and-creation load.',s:engine,gate:mpg>=18&&(ppg+apg)>=12},
    {c:'DEF',n:'Rim Guardian',d:'Protects the paint and blocks shots.',s:blkS,gate:blk>=0.4},
    {c:'DEF',n:'Passing-Lane Bandit',d:'Jumps passing lanes and forces turnovers.',s:stlS,gate:stl>=0.6},
    {c:'DEF',n:'Glass Eater',d:'Controls the boards on the glass.',s:rebS,gate:rpg>=2},
    {c:'DEF',n:'Two-Way Disruptor',d:'Fills the box score defensively (steals + blocks).',s:disrupt,gate:(stl+blk)>=1.1}
  ];
  var out={FIN:[],SHO:[],PLY:[],DEF:[]};
  defs.forEach(function(b){
    if(!b.gate) return;
    var t=_badgeTier(b.s); if(!t) return;
    out[b.c].push({name:b.n,desc:b.d,tier:t,score:b.s});
  });
  Object.keys(out).forEach(function(k){ out[k].sort(function(a,b){return b.score-a.score;}); });
  var total=out.FIN.length+out.SHO.length+out.PLY.length+out.DEF.length;
  var basis = meta.projected ? '2026-27 projected' : (meta.label ? meta.label+' actual' : 'current');
  return {cats:CAT, badges:out, total:total, basis:basis};
}
// badges for a given Overview season selection (null=default, 'proj', or a year)
function badgesForSeason(val){ var x=_skillSrcFor(val); return computeBadges(player, x.src, {projected:x.projected, label:x.label}); }
function renderBadges(val){
  var B=badgesForSeason(val);
  var bs=document.getElementById('badgesSection'); if(bs) bs.innerHTML=buildBadgesSection(player, B);
  var hs=document.getElementById('heroBadgeSlot'); if(hs) hs.innerHTML=buildBadgeShield(B);
}
// graphic badge shield for the hero — total earned inside a shield, tier
// breakdown underneath. The shield tint is driven by the player's TOP tier.
function buildBadgeShield(B){
  if(!B||!B.total) return '';
  var counts={};
  ['FIN','SHO','PLY','DEF'].forEach(function(c){ B.badges[c].forEach(function(b){ counts[b.tier.name]=(counts[b.tier.name]||0)+1; }); });
  var dots=BADGE_TIERS.filter(function(t){return counts[t.name];}).map(function(t){
    return '<span class="hbs-dot" title="'+counts[t.name]+' '+t.name+'"><i style="background:'+t.color+';"></i>'+counts[t.name]+'</span>';
  }).join('');
  var top=BADGE_TIERS.find(function(t){return counts[t.name];})||BADGE_TIERS[BADGE_TIERS.length-1]; // highest tier present
  var g=({'All-American':['#d3b3ff','#7c3fd6'],'Star':['#f2d67a','#c08a12'],'Starter':['#d6dbe4','#8b93a1'],'Prospect':['#e0b184','#a9743f']})[top.name]||['#d3b3ff','#7c3fd6'];
  var n=B.total, fs=n>=100?30:n>=10?42:52;
  return '<a class="hero-badge-wrap" href="#" onclick="switchTab(\'overview\');var el=document.querySelector(\'.badge-grid\');if(el)el.scrollIntoView({behavior:\'smooth\',block:\'center\'});return false;" title="'+n+' badges earned — click to view">'+
    '<div class="hero-badge-shield">'+
      '<svg viewBox="0 0 100 118" aria-hidden="true">'+
        '<defs><linearGradient id="bgSh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="'+g[0]+'"/><stop offset="1" stop-color="'+g[1]+'"/></linearGradient></defs>'+
        '<path d="M50 3 L91 19 V56 Q91 86 50 114 Q9 86 9 56 V19 Z" fill="url(#bgSh)" stroke="#fff" stroke-width="3" stroke-opacity=".85"/>'+
        '<ellipse cx="50" cy="33" rx="30" ry="15" fill="#fff" opacity=".16"/>'+
        '<path d="M50 12 L82 24 V55 Q82 79 50 101 Q18 79 18 55 V24 Z" fill="none" stroke="#fff" stroke-width="1.4" stroke-opacity=".4"/>'+
        '<text x="50" y="60" text-anchor="middle" dominant-baseline="middle" font-family="Playfair Display, serif" font-weight="800" font-size="'+fs+'" fill="#fff">'+n+'</text>'+
      '</svg>'+
    '</div>'+
    '<div class="hero-grade-lbl">Badges</div>'+
    (dots?'<div class="hbs-dots">'+dots+'</div>':'')+
  '</a>';
}
// hexagon badge medallion for the avatar corner — matches the hex crest tiles in
// the badges section. Count inside, tint driven by the player's top tier.
function buildBadgeMedal(B){
  if(!B||!B.total) return '';
  var counts={};
  ['FIN','SHO','PLY','DEF'].forEach(function(c){ (B.badges[c]||[]).forEach(function(b){ counts[b.tier.name]=(counts[b.tier.name]||0)+1; }); });
  var top=BADGE_TIERS.find(function(t){return counts[t.name];})||BADGE_TIERS[BADGE_TIERS.length-1];
  var g=({'All-American':['#e2c9ff','#7c3fd6'],'Star':['#f7dd8a','#c08a12'],'Starter':['#e2e7ef','#8b93a1'],'Prospect':['#ecc199','#a9743f']})[top.name]||['#e2c9ff','#7c3fd6'];
  var n=B.total, fs=n>=100?26:n>=10?31:38, hex='M50 3 L93 26 L93 74 L50 97 L7 74 L7 26 Z';
  return '<button class="hero-badge-medal" title="'+n+' badges earned · '+top.name+'-tier best — view all" onclick="switchTab(\'overview\');var el=document.querySelector(\'.badge-grid2,.badge-grid\');if(el)el.scrollIntoView({behavior:\'smooth\',block:\'center\'});return false;">'+
    '<svg viewBox="0 0 100 100" aria-hidden="true">'+
      '<defs><linearGradient id="bmGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="'+g[0]+'"/><stop offset="1" stop-color="'+g[1]+'"/></linearGradient></defs>'+
      '<path d="'+hex+'" fill="url(#bmGrad)" stroke="var(--bg)" stroke-width="6"/>'+
      '<path d="'+hex+'" fill="none" stroke="#fff" stroke-width="2" stroke-opacity=".55"/>'+
      '<path d="M50 12 L85 31 V69 L50 88 L15 69 V31 Z" fill="none" stroke="#fff" stroke-width="1.1" stroke-opacity=".32"/>'+
      '<path d="M50 3 L93 26 L50 41 L7 26 Z" fill="#fff" opacity=".16"/>'+
      '<text x="50" y="57" text-anchor="middle" dominant-baseline="middle" font-family="Playfair Display, serif" font-weight="800" font-size="'+fs+'" fill="#fff" style="paint-order:stroke;stroke:rgba(0,0,0,.28);stroke-width:2px;">'+n+'</text>'+
    '</svg>'+
  '</button>';
}
// hero badge display: one tier-colored shield per earned tier, with its count
function buildBadgeShields(B){
  if(!B||!B.total) return '<span class="hg-dash">—</span>';
  var counts={};
  ['FIN','SHO','PLY','DEF'].forEach(function(c){ (B.badges[c]||[]).forEach(function(b){ if(b.tier) counts[b.tier.name]=(counts[b.tier.name]||0)+1; }); });
  var GRAD={'All-American':['#ffd76a','#e0952a'],'Star':['#c9b3ff','#8b5cf6'],'Starter':['#f6f9fc','#9aa5b5'],'Prospect':['#f2c99b','#96612f']};
  var out=BADGE_TIERS.filter(function(t){return counts[t.name];}).map(function(t){
    var g=GRAD[t.name]||['#ccc','#888'], id='bsh'+t.name.replace(/[^a-z]/gi,'');
    return '<span class="bshield" title="'+counts[t.name]+' '+t.name+'-tier badge'+(counts[t.name]>1?'s':'')+'">'+
      '<svg viewBox="0 0 40 46" aria-hidden="true"><defs><linearGradient id="'+id+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="'+g[0]+'"/><stop offset="1" stop-color="'+g[1]+'"/></linearGradient></defs>'+
      '<path d="M20 1 L38 7 V22 C38 34 30 41 20 45 C10 41 2 34 2 22 V7 Z" fill="url(#'+id+')" stroke="rgba(255,255,255,.55)" stroke-width="1.1"/>'+
      '<path d="M20 1 L38 7 L20 13 L2 7 Z" fill="#fff" opacity=".2"/></svg>'+
      '<b>'+counts[t.name]+'</b></span>';
  }).join('');
  return out||'<span class="hg-dash">—</span>';
}
function buildBadgesSection(p, B){
  B=B||computeBadges(p, null, {});
  var order=['FIN','SHO','PLY','DEF'];
  var CATCOL={FIN:'var(--pd-ink)',SHO:'#5B8DEF',PLY:'#8B7CFF',DEF:'#F5B942'};
  var CATLBL={FIN:'Finishing',SHO:'Shooting',PLY:'Playmaking',DEF:'Defense'};
  var ICON={
    FIN:'<path d="M12 2v13m0 0l-4.5-4.5M12 15l4.5-4.5" stroke="currentColor" stroke-width="2.1" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 19h16" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>',
    SHO:'<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="12" cy="12" r="3.6" stroke="currentColor" stroke-width="2" fill="none"/>',
    PLY:'<circle cx="5.5" cy="6.5" r="2.6" fill="currentColor"/><circle cx="18.5" cy="6.5" r="2.6" fill="currentColor"/><circle cx="12" cy="18" r="2.6" fill="currentColor"/><path d="M7.6 8.2L11 15.6M16.4 8.2L13 15.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
    DEF:'<path d="M12 2.8l7.4 3.1v5.4c0 4.7-3.1 8.5-7.4 10.6C7.7 19.8 4.6 16 4.6 11.3V5.9z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>'
  };
  // tier -> [light, dark, glow] metallic ramp: gold / purple / silver / bronze
  var RAMP={'All-American':['#ffe08a','#c47f14','#e0952a'],'Star':['#d8c4ff','#7c3fd6','#8b5cf6'],'Starter':['#f6f9fc','#9aa5b5','#c6cfdb'],'Prospect':['#f2c99b','#96612f','#c68a4f']};
  // one unique bold icon per badge
  var IC={
    'Court General':'<path d="M3 8l4 3 5-6 5 6 4-3-2 11H5z" fill="#fff"/><circle cx="12" cy="4" r="1.7" fill="#fff"/>',
    'Dime Machine':'<circle cx="5" cy="7" r="2.4" fill="#fff"/><circle cx="19" cy="7" r="2.4" fill="#fff"/><path d="M7 8.6C10 12 14 12 17 8.6" fill="none" stroke="#fff" stroke-width="2.2"/><path d="M15.4 11.2l2-2.6-3-.3z" fill="#fff"/><circle cx="12" cy="18" r="2.4" fill="#fff"/>',
    'Sure Hands':'<path d="M6 11V6.5a1.5 1.5 0 013 0V10m0-.5V5a1.5 1.5 0 013 0v5m0-.5V6a1.5 1.5 0 013 0v6.5c0 4-2.5 7-6 7s-6-2.6-6-6.5V10a1.5 1.5 0 013 0z" fill="#fff"/>',
    'Offensive Engine':'<path d="M12 2.2l1.4 2.4 2.7-.6.2 2.8 2.6 1-1.3 2.5 1.3 2.5-2.6 1-.2 2.8-2.7-.6L12 21.8l-1.4-2.4-2.7.6-.2-2.8-2.6-1 1.3-2.5L5.1 11l2.6-1 .2-2.8 2.7.6z" fill="#fff"/><circle cx="12" cy="12" r="3" fill="rgba(0,0,0,.32)"/>',
    'Sniper':'<circle cx="12" cy="12" r="9" fill="none" stroke="#fff" stroke-width="2.4"/><circle cx="12" cy="12" r="2.6" fill="#fff"/><path d="M12 1v5M12 18v5M1 12h5M18 12h5" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>',
    'Pure Stroke':'<path d="M6 5h12l-.8 12-4.2 2-4.2-2z" fill="none" stroke="#fff" stroke-width="1.9" stroke-linejoin="round"/><path d="M9.4 5l.5 12M14.6 5l-.5 12M7.5 11h9" stroke="#fff" stroke-width="1.7"/><circle cx="12" cy="3" r="1.9" fill="#fff"/>',
    'Free-Throw Merchant':'<rect x="6" y="4" width="12" height="2.4" rx="1" fill="#fff"/><path d="M8 6.4v4a4 4 0 008 0v-4" fill="none" stroke="#fff" stroke-width="2.2"/><circle cx="12" cy="17.5" r="3.2" fill="#fff"/>',
    'Floor Spacer':'<path d="M3 19a9 9 0 0118 0" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><path d="M3 19h2.6M18.4 19H21" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><circle cx="12" cy="7.2" r="2.3" fill="#fff"/>',
    'Rim Finisher':'<circle cx="12" cy="6.5" r="3.4" fill="#fff"/><path d="M5 13h14M6.4 13l1 6M17.6 13l-1 6M9.2 13l.5 6.6M14.8 13l-.5 6.6M12 13v6.7" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
    'Contact Absorber':'<path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z" fill="#fff"/><path d="M9 12l2 2 4-4.5" stroke="rgba(0,0,0,.38)" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    'Second-Chance Threat':'<path d="M6 8.4a7 7 0 0111-1.6" fill="none" stroke="#fff" stroke-width="2.2"/><path d="M17.4 3.2v4h-4" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 15.6a7 7 0 01-11 1.6" fill="none" stroke="#fff" stroke-width="2.2"/><path d="M6.6 20.8v-4h4" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.4" fill="#fff"/>',
    'Downhill Driver':'<path d="M13 2L4 13h5l-2 9 10-12h-5z" fill="#fff"/>',
    'Rim Guardian':'<path d="M7 21V10.2a1.6 1.6 0 013.1 0V8.7a1.6 1.6 0 013.1 0V9a1.6 1.6 0 013.1 0v7c0 3-2.2 5-5.1 5z" fill="#fff"/><path d="M9.2 3.4l1.9 3M14.8 3.4l-1.9 3M12 2.2v3.6" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>',
    'Passing-Lane Bandit':'<path d="M3.5 12c3.2-4.4 13.8-4.4 17 0-3.2 4.4-13.8 4.4-17 0z" fill="none" stroke="#fff" stroke-width="2.1"/><circle cx="12" cy="12" r="3.1" fill="#fff"/><path d="M14 10l4.5-4" stroke="#fff" stroke-width="2.1" stroke-linecap="round"/>',
    'Glass Eater':'<rect x="4" y="4" width="16" height="10" rx="1.5" fill="none" stroke="#fff" stroke-width="2.2"/><rect x="9" y="8" width="6" height="4" rx=".6" fill="none" stroke="#fff" stroke-width="1.9"/><circle cx="12" cy="19" r="2.6" fill="#fff"/><path d="M12 14v2.2" stroke="#fff" stroke-width="1.8"/>',
    'Two-Way Disruptor':'<path d="M6 3l12 12M18 3L6 15" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><path d="M4 15l3 6 2-3 2 3 1-8z" fill="#fff"/><path d="M20 15l-3 6" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>'
  };
  // flat tier disc (Oct 2026): solid tier colour + white icon, no gloss / rim / glow
  var FLAT={'All-American':'#B8860B','Star':'#6D4BC2','Starter':'#6E7787','Prospect':'#8A5A2B'};
  function frame(nm,t){
    return '<span class="bframe flat" style="background:'+(FLAT[t.name]||'#6E7787')+'">'+
      '<svg viewBox="0 0 24 24">'+(IC[nm]||ICON[order.find(function(c){return (B.badges[c]||[]).some(function(b){return b.name===nm;});})]||'')+'</svg></span>';
  }
  var cats=order.filter(function(c){return (B.badges[c]||[]).length;}).map(function(c){
    var list=(B.badges[c]||[]).slice().sort(function(a,b){return ((b.tier&&b.tier.pips)||0)-((a.tier&&a.tier.pips)||0);});
    var rows=list.map(function(b){ var t=b.tier||{name:''}, r=RAMP[t.name]||['#dfe6f0','#8b94a3','#aab4c2'];
      return '<div class="bbadge" title="'+(b.desc||'').replace(/"/g,'&quot;')+'">'+frame(b.name,t)+
        '<span class="bb-txt"><span class="bb-nm">'+b.name+'</span><span class="bb-tier" style="color:'+(FLAT[t.name]||'#6E7787')+'">'+t.name+'</span></span></div>';
    }).join('');
    return '<div class="bcat"><div class="bcat-h"><span class="bcat-dot" style="background:'+CATCOL[c]+'"></span>'+CATLBL[c]+'</div>'+rows+'</div>';
  }).join('');
  return '<div class="badge-head"><span class="badge-count">'+B.total+' earned</span>'+
    '<span class="badge-sub">From '+B.basis+' production. Tiers: All-American \u203a Star \u203a Starter \u203a Prospect.</span></div>'+
    '<div class="bcats">'+(cats||'<div class="badge-empty">No badges yet</div>')+'</div>';
}
