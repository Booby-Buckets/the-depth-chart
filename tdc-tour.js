/* tdc-tour.js — "Explain this page": a spotlight walkthrough of the tools on the page you're on.
 *
 * The homepage's first-visit tour (spotlight + tip card) generalised into one module:
 *   • a fixed  ? Explain  pill on every page that has a walkthrough (bottom-left, above the fold-in)
 *   • steps per page, keyed by the page filename below (sel = what to spotlight, t/d = copy,
 *     tab = a page tab to open first via switchTab, before = any prep function)
 *   • missing targets are skipped, so a gated/blurred section or an empty state can't strand it
 *   • the homepage still auto-plays once on a first visit (localStorage tdc_tour_done); every
 *     other page is on demand only
 * Add a page: TDCTour.register('foo.html', [ {sel:'#x', t:'…', d:'…'}, … ]) or edit TOURS below.
 */
(function (g) {
  var CSS = '\
#tdcTourWrap{position:fixed;inset:0;z-index:9000;display:none;}\
#tdcTourWrap.on{display:block;}\
.tdc-tour-spot{position:absolute;border-radius:12px;box-shadow:0 0 0 9999px rgba(8,10,18,.74);transition:all .32s cubic-bezier(.22,1,.36,1);pointer-events:none;}\
.tdc-tour-tip{position:absolute;max-width:320px;background:var(--bg2,#fff);border:1px solid var(--border2,#ccd);border-radius:14px;padding:16px 18px;box-shadow:0 18px 50px -12px rgba(0,0,0,.6);transition:all .32s cubic-bezier(.22,1,.36,1);}\
.tdc-tour-step{font-size:9.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--accent,#3b5bdb);margin-bottom:6px;}\
.tdc-tour-t{font-weight:800;font-size:15px;color:var(--text,#111);margin-bottom:5px;}\
.tdc-tour-d{font-size:13px;color:var(--text2,#445);line-height:1.5;}\
.tdc-tour-nav{display:flex;align-items:center;justify-content:space-between;margin-top:14px;gap:10px;}\
.tdc-tour-skip{font-size:12px;font-weight:600;color:var(--text3,#778);background:none;border:none;cursor:pointer;padding:4px;}\
.tdc-tour-skip:hover{color:var(--text2,#445);}\
.tdc-tour-next{font-size:12.5px;font-weight:800;color:#141416;background:var(--accent,#E6D5A8);border:none;border-radius:20px;padding:8px 18px;cursor:pointer;}\
.tdc-tour-dots{display:flex;gap:5px;}\
.tdc-tour-dot{width:6px;height:6px;border-radius:50%;background:var(--border2,#ccd);}\
.tdc-tour-dot.on{background:var(--accent,#3b5bdb);}\
.tdc-explain{position:fixed;left:16px;bottom:16px;z-index:8000;display:inline-flex;align-items:center;gap:7px;padding:8px 13px 8px 10px;border-radius:22px;\
  background:var(--bg2,#fff);color:var(--text,#111);border:1px solid var(--border2,#ccd);box-shadow:0 8px 24px -8px rgba(0,0,0,.45);font:700 12px/1 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif;letter-spacing:.02em;cursor:pointer;transition:transform .15s,box-shadow .15s;}\
.tdc-explain:hover{transform:translateY(-1px);box-shadow:0 12px 28px -8px rgba(0,0,0,.5);}\
.tdc-explain i{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:var(--accent,#3b5bdb);color:#141416;font-style:normal;font-size:11px;font-weight:900;}\
@media(max-width:760px){.tdc-explain{left:12px;bottom:12px;padding:8px 11px 8px 9px;}.tdc-explain span{display:none;}}\
@media print{.tdc-explain,#tdcTourWrap{display:none !important;}}';

  // ── walkthroughs, by page ──────────────────────────────────────────────────
  var TOURS = {
    'index.html': [
      { sel:'#whStrip',      t:'Start here',      d:"New here? These four cards are your fastest way in — the full map, your team's HQ, player compare, and opponent scouting." },
      { sel:'#searchInput',  t:'Find any team',   d:'Type a school to jump straight to it — or use the conference pills just below to filter.' },
      { sel:'.table-scroll', t:'The rankings',    d:'Every Division-I team, ranked by Power Rating. Click any team name to open its full HQ — depth chart, DNA, projections and more.' },
      { sel:'.tdn-wrap',     t:'Everything else', d:'Players, analytics and postseason live up here — and ✦ Explore (under More) is a one-page map of every tool on the site.' }
    ],
    'team.html': [
      { sel:'#teamHero',        t:'The team header',  d:'Overall, Power Rating, projected record and national rank for the season you have selected. The season switcher below it moves everything on the page between the 2026-27 projection and any past year.' },
      { sel:'.hero-tabs',       t:'The tabs',         d:'Depth Chart, Schedule and Preview are the core. Analytics ▾ opens Team DNA, projected stats, shot charts, on/off and lineups; Coach\'s Tier ▾ holds the scouting tools.' },
      { sel:'#playerSpotlight', t:'Player spotlight', d:'Click any name on the depth chart and his card lands here — projected OVR, role, badges and line. Click the name again to open his full page.', tab:'depth' },
      { sel:'.dc-grid',         t:'The depth chart',  d:'The rotation by position with projected minutes and OVR for every player. ★ marks projected starters; the minutes are the same ones his player page shows.', tab:'depth' },
      { sel:'#panel-schedule',  t:'Schedule',         d:'Every game with a projected line and win probability, plus a simulated season record range.', tab:'schedule' },
      { sel:'#panel-preview',   t:'Game preview',     d:'Pick any opponent for a full matchup preview: projected score, four-factor edges and each player\'s projected line in that game.', tab:'preview' },
      { sel:'#customizeContent',t:'Lineup Lab',       d:'Build your own five: drag players in and out and the projected lineup stats update live.', tab:'customize' }
    ],
    'player.html': [
      { sel:'.player-hero',   t:'The player card',   d:'His projected OVR (the same number every page shows), Wins Added, Big Board slot and rank at his position. The season switcher swaps the whole page between the projection and each real season.' },
      { sel:'.tab-row',       t:'The tabs',          d:'Overview is the stat line and outlook. Player DNA is the analyst view (offense/defense/six-factor). Stats, Shots & Rankings, NIL, Buzz and Betting each go a level deeper.' },
      { sel:'#tdcSeasonSlot', t:'Season switcher',   d:'2026-27 Projected is the model\'s line; every other entry is a real season he played, with the grade he earned that year.' },
      { sel:'#ovrCards',      t:'Actual vs projected', d:'Last season on the left, the projected line on the right, with the change on each stat — minutes, usage and the role behind the numbers.' },
      { sel:'#panel-percentiles', t:'Percentiles',   d:'Where each skill sits against every D-I player at his position group — the bar is his rank, the tick is the median.', before:function(){ try{ if(typeof _grpPick==='function') _grpPick('percentiles'); else if(typeof switchTab==='function') switchTab('percentiles'); }catch(e){} } }
    ],
    'compare-players.html': [
      { sel:'#modePlayers',     t:'Players or teams',  d:'Compare two players or two programs. Both modes accept any season back to 2006-07, not just current rosters.' },
      { sel:'#si1',             t:'Pick your two',     d:'Type a name; current players list first and past seasons below them. A past season is compared as that year\'s player.' },
      { sel:'#compareSection',  t:'The comparison',    d:'Stat sheets, skill wheels, head-to-head matchup, chemistry if they shared a lineup, shot charts and a next-season projection — each row highlights who has the edge.' }
    ],
    'roster.html': [
      { sel:'#seasonFilter', t:'Filters',           d:'Season, conference, team, position, class, height, grade and Wins Added — stack as many as you like. 2026-27 shows every player\'s projected line; ⚙ Query Builder adds stat thresholds.' },
      { sel:'#searchInput',  t:'Search',            d:'Any player, any season, by name.' },
      { sel:'#tableContainer', t:'The database',    d:'Click a column to sort. The OVR column is the same projected grade the player and team pages show; the colour toggle shades every stat by national percentile.' }
    ],
    'team-stats.html': [
      { sel:'#searchBox',   t:'Find a team',     d:'Type a school, or filter by conference and the pool you want to compare against.' },
      { sel:'#leadersEl',   t:'Leaders',         d:'Who projects to lead the country in each category.' },
      { sel:'#statsTable',  t:'Projected team stats', d:'Every rostered program\'s projected per-game line, built from its players\' projected lines. Click a column to sort; colour shading is the national percentile.' }
    ],
    'analytics.html': [
      { sel:'#leadersView',   t:'Leaders',          d:'National leaderboards on the site\'s own metrics — Wins Added, TI, usage, shooting — for any season.' },
      { sel:'#explorerView',  t:'Explorer',         d:'Plot any two stats against each other across every player; pick the axes and the season.', before:function(){ try{ setView('explorer'); }catch(e){} } },
      { sel:'#landscapeView', t:'Landscape',        d:'The league at a glance: contender quadrant, scoring bubbles and March drop-offs.', before:function(){ try{ setView('landscape'); }catch(e){} } }
    ],
    'betting.html': [
      { sel:'#sharpGrid',  t:'Sharp trends',   d:'Team and player trends against the number, built on twenty seasons of real lines.' },
      { sel:'#playerCard', t:'Player props',   d:'Search a player for his projected prop lines and the edges the model sees.' },
      { sel:'#mlOut',      t:'Matchup line',   d:'Pick two teams for a projected spread, total and win probability — neutral or home court.' }
    ],
    'moneyball.html': [
      { sel:'#mbTabs',      t:'Four rooms',       d:'The Market prices every roster in Wins Added; Front Office turns a goal into the win gap and the recipes to close it; GM Mode lets you build a roster under a cap; The Ledger is the value scatter.' },
      { sel:'#tab-office',  t:'Front Office',     d:'Search a team, pick a goal — a seed, a win total — and the tool works back to what the roster is missing and the concrete ways to fix it.', before:function(){ try{ showTab('office'); }catch(e){} } },
      { sel:'#gmDash',      t:'GM Mode',          d:'Build a roster under a budget from the real portal pool and watch the projected wins move.', before:function(){ try{ showTab('gm'); }catch(e){} } },
      { sel:'#ledScatterHost', t:'The Ledger',    d:'Each dot is a program: what its roster produces against what it costs. Above the line is surplus value.', before:function(){ try{ showTab('ledger'); }catch(e){} } }
    ],
    'portal.html': [
      { sel:'#pickPlayer',   t:'Pick a player',     d:'Any transfer-portal player. The tool ranks every program by how well he fits.' },
      { sel:'#wgrid',        t:'What "fit" means',  d:'Need at his position, team success, his production and coach-fit — set the weights the way you value them.' },
      { sel:'#results',      t:'Best fits',         d:'Programs ranked by fit score, with the reasons behind each one.' }
    ],
    'transfer-fit.html': [
      { sel:'#picker',  t:'Player → school',   d:'Pick any player and any destination — even a move that hasn\'t happened — and the report models the fit.' },
      { sel:'#report',  t:'The report',        d:'Role on the new roster, projected line, minutes impact on the current players and the coach/system fit.' }
    ],
    'coach.html': [
      { sel:'.chero',    t:'The coach',          d:'Career record, tenure and the TDC Coach Grade with its national rank.' },
      { sel:'.gparts',   t:'Four parts of the grade', d:'Winning and quality, tournament peak, player development and consistency — each against the median coach.' },
      { sel:'#rundown',  t:'Rundown',            d:'How he plays: pace, shot diet, rotation size and scoring identity, from his teams\' real box scores.' },
      { sel:'#rosterfit',t:'Roster fit',         d:'How this year\'s roster suits the way he coaches.' }
    ],
    'conference.html': [
      { sel:'#tiles',  t:'The league in numbers', d:'Composite record, best team, NCAA results for the season you picked.' },
      { sel:'#stand',  t:'Standings',            d:'Conference and overall records, Power Rating, seed and how far each team went. Click a team to open its HQ.' },
      { sel:'#awards', t:'Conference awards',    d:'Player of the year, all-conference teams and the rest — projected for 2026-27, actual for past seasons.' }
    ],
    'awards.html': [
      { sel:'#seasonPills', t:'Season',          d:'Projected 2026-27 awards, or the real winners for any past season.' },
      { sel:'#content',     t:'The ballot',      d:'All-America teams, conference honours and all-freshman teams, chosen by projected impact — the OVR shown is the same one the player pages use.' }
    ],
    'tournaments.html': [
      { sel:'#catPills',     t:'Tournaments',       d:'NCAA, NIT and the conference tournaments, by season.' },
      { sel:'#tlist',        t:'The field',         d:'Every team in the field with seed, result and how the model rated them going in; click one for its bracket.' },
      { sel:'#marchInsights',t:'March insights',    d:'What the data says wins in March — and which profiles fall early.' }
    ],
    'shot-genome.html': [
      { sel:'#mode',  t:'Look Quality vs Shot-Making', d:'Two original metrics: how good a player\'s looks are, and how much he adds on top of them.' },
      { sel:'#quad',  t:'The quadrant',          d:'Every player placed by the quality of his shots and his finishing — the top right is the elite.' }
    ],
    'explore.html': [
      { sel:'#xpFilter', t:'Every tool',      d:'Filter the map by what you are trying to do — a player, a team, a matchup, the portal.' },
      { sel:'#xpBody',   t:'The map',         d:'Every page on the site with a one-line description. Start anywhere.' },
      { sel:'#xpGloss',  t:'Glossary',        d:'What each stat means, in plain English.' }
    ]
  };

  var STEPS = null, i = 0, W = null;
  function page(){ var p = (location.pathname.split('/').pop() || 'index.html'); return p === '' ? 'index.html' : p; }
  function q(sel){ try { return document.querySelector(sel); } catch (e) { return null; } }
  function visible(el){ if (!el) return false; var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }

  function ensureDom(){
    if (W) return;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    W = document.createElement('div'); W.id = 'tdcTourWrap'; W.setAttribute('role', 'dialog'); W.setAttribute('aria-label', 'Page walkthrough');
    W.innerHTML = '<div class="tdc-tour-spot" id="tdcTourSpot"></div>'
      + '<div class="tdc-tour-tip" id="tdcTourTip"><div class="tdc-tour-step" id="tdcTourStep"></div><div class="tdc-tour-t" id="tdcTourTitle"></div><div class="tdc-tour-d" id="tdcTourDesc"></div>'
      + '<div class="tdc-tour-nav"><button class="tdc-tour-skip" type="button">Skip</button><div class="tdc-tour-dots" id="tdcTourDots"></div><button class="tdc-tour-next" type="button">Next</button></div></div>';
    document.body.appendChild(W);
    W.querySelector('.tdc-tour-skip').addEventListener('click', end);
    W.querySelector('.tdc-tour-next').addEventListener('click', next);
    document.addEventListener('keydown', function (e) { if (!W.classList.contains('on')) return; if (e.key === 'Escape') end(); if (e.key === 'ArrowRight' || e.key === 'Enter') next(); });
  }
  function prep(step){
    try {
      if (step.tab) {
        // click the page's own tab control when there is one (team.html's switchTab needs the button)
        var btn = null, cands = document.querySelectorAll('[onclick*="switchTab("], [data-tab]');
        for (var k = 0; k < cands.length && !btn; k++) {
          var oc = cands[k].getAttribute('onclick') || '', dt = cands[k].getAttribute('data-tab') || '';
          if (oc.indexOf("switchTab('" + step.tab + "'") >= 0 || oc.indexOf('switchTab("' + step.tab + '"') >= 0 || dt === step.tab) btn = cands[k];
        }
        if (btn) btn.click(); else if (typeof g.switchTab === 'function') { try { g.switchTab(step.tab); } catch (e) {} }
      }
      if (typeof step.before === 'function') step.before();
    } catch (e) {}
  }
  function place(){
    var el = STEPS[i] ? q(STEPS[i].sel) : null;
    if (STEPS[i] && (STEPS[i].tab || STEPS[i].before)) { prep(STEPS[i]); el = q(STEPS[i].sel); }
    var guard = 0;
    while (!visible(el) && i < STEPS.length - 1 && guard < STEPS.length) { i++; prep(STEPS[i]); el = q(STEPS[i].sel); guard++; }
    if (!visible(el)) { end(); return; }
    var tall = function(){ return el.getBoundingClientRect().height > window.innerHeight - 80; };
    var scrollTo = function(){ try { el.scrollIntoView({ behavior: 'smooth', block: tall() ? 'start' : 'center' }); } catch (e) {} };
    scrollTo();
    var my = ++_seq;
    // measure once the scroll settles, then again after a tab's content has rendered (panels load
    // async — a first measure of a just-opened Schedule tab caught it empty), and once more late
    // for slow data; each pass re-centres if the target grew
    [360, 1200, 2600].forEach(function (ms, n) { setTimeout(function () { if (my !== _seq) return; if (n) scrollTo(); setTimeout(function () { if (my === _seq) measure(el); }, n ? 350 : 0); }, ms); });
  }
  var _seq = 0;
  function measure(el){
    {
      var r = el.getBoundingClientRect(), pad = 8;
      var spot = document.getElementById('tdcTourSpot');
      // a target taller than the screen is lit from its top edge (never from above the viewport)
      var sTop = Math.max(r.top, 8), sH = Math.min(r.bottom - sTop, window.innerHeight - sTop - 12);
      spot.style.left = (r.left - pad) + 'px'; spot.style.top = (sTop - pad) + 'px';
      spot.style.width = (r.width + pad * 2) + 'px'; spot.style.height = (sH + pad * 2) + 'px';
      document.getElementById('tdcTourStep').textContent = 'Step ' + (i + 1) + ' of ' + STEPS.length;
      document.getElementById('tdcTourTitle').textContent = STEPS[i].t;
      document.getElementById('tdcTourDesc').textContent = STEPS[i].d;
      W.querySelector('.tdc-tour-next').textContent = (i === STEPS.length - 1) ? 'Got it' : 'Next';
      document.getElementById('tdcTourDots').innerHTML = STEPS.map(function (_, k) { return '<span class="tdc-tour-dot' + (k === i ? ' on' : '') + '"></span>'; }).join('');
      var tip = document.getElementById('tdcTourTip'); var th = tip.offsetHeight || 160, tw = Math.min(320, window.innerWidth - 24);
      var bottom = sTop + sH;
      var top = bottom + 14; if (top + th > window.innerHeight - 12) top = Math.max(12, sTop - th - 14);
      if (top + th > window.innerHeight - 12 || top < 12) top = Math.max(12, Math.min(sTop + 24, window.innerHeight - th - 12));   // tall target: tip sits inside its top
      var left = Math.min(Math.max(12, r.left), window.innerWidth - tw - 12);
      tip.style.top = top + 'px'; tip.style.left = left + 'px';
    }
  }
  function next(){ if (i >= STEPS.length - 1) { end(); return; } i++; place(); }
  function end(){ if (!W) return; _seq++; W.classList.remove('on'); window.removeEventListener('resize', place); try { if (page() === 'index.html') localStorage.setItem('tdc_tour_done', '1'); } catch (e) {} }
  function start(steps){
    STEPS = steps || TOURS[page()]; if (!STEPS || !STEPS.length) return false;
    ensureDom(); i = 0; W.classList.add('on'); place(); window.addEventListener('resize', place); return true;
  }
  function button(){
    if (!TOURS[page()] || document.querySelector('.tdc-explain')) return;
    var b = document.createElement('button'); b.type = 'button'; b.className = 'tdc-explain'; b.setAttribute('aria-label', 'Explain this page');
    b.innerHTML = '<i>?</i><span>Explain this page</span>';
    b.addEventListener('click', function () { start(); });
    document.body.appendChild(b);
  }
  function boot(){
    button();
    if (page() === 'index.html') {
      var done = true; try { done = localStorage.getItem('tdc_tour_done') === '1'; } catch (e) {}
      if (!done) setTimeout(function () { start(); }, 1200);   // first visit: auto-play once, like before
    }
  }
  if (document.readyState === 'complete') setTimeout(boot, 400); else window.addEventListener('load', function () { setTimeout(boot, 400); });
  g.TDCTour = { start: start, end: end, register: function (pg, steps) { TOURS[pg] = steps; if (pg === page()) button(); }, tours: TOURS };
})(window);
