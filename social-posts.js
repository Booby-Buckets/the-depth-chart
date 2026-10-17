/* social-posts.js — the registry behind Social Studio's "Posts" graphic (owner, Oct 15 2026: "build all of the first 34").
 *
 * Every post type is one file in js/posts/ that registers itself:
 *
 *   TDC_POSTS.add('shotzones', {
 *     group: 'Shooting', label: 'Team hot zones',
 *     opts: { team: true, conf: false, n: 8, season: true,         // which filters the editor shows (+ default rows)
 *             seasonList: [['2027','2026-27 projected'],['2026','2025-26']], dir: true, upLabel, downLabel, teamRequired,
 *             stats: [[value,label],...], statsLabel, tier },   // tier = a High/Mid/Low major filter (d.tier: H/M/L)   // stats = a stat picker; the choice arrives as d.pstat
 *     load: async function(d, H){ ... return {
 *       title, subtitle, lead,              // lead = the amber lead column's label ('' = no lead column)
 *       src,                                // the "Data:" footer line
 *       cols: [{k, lab, inv, off}],         // heat columns (values in each row under r[k]); inv:true = lower is better;
 *                                           // off:true = available but starts hidden (the owner toggles columns in the editor)
 *                                           // (no heat at all: give the column nodist:true or leave its dist empty)
 *       rows: [{ name, team, espn, tag, val, <k>: v }],   // team = logo, espn = headshot, tag = small grey note, val = lead value
 *       dist: { <k>: [numbers] },           // optional: the pool each heat column is coloured against (default = these rows)
 *       players: true                       // rows are players (headshots on by default)
 *     }; }
 *   });
 *
 * H (helpers handed to load) — json(path), ratings(), players(), needScript(src), school(t), confName(c), confOfFull(t),
 * onTeam(t, sel), tkey(t), nowTeam(espn), logoUrl(t), lineOf(p), gradeSolo(p), tierOf(conf), SEASON, fmt(v, dec, plus).
 */
(function(g){
  var R = {}, ORDER = [];
  g.TDC_POSTS = {
    add: function(key, def){ if(!R[key]) ORDER.push(key); def.key = key; R[key] = def; },
    get: function(key){ return R[key]; },
    list: function(){ return ORDER.map(function(k){ return R[k]; }); },
    // every post file; loaded on first use of the Posts graphic
    FILES: ['shotzones','statshift','duos','passing','portal','continuity','freshmen','breakouts','archetypes','coaching',
            'schedules','bracket','teamdna','teamranks','programs','size','betting','plays','scrimmages','scrimplayers','payrolls'],
    loadAll: function(need){ return Promise.all(g.TDC_POSTS.FILES.map(function(f){ return need('js/posts/'+f+'.js?v=11').catch(function(){ return null; }); })); }
  };
})(window);
