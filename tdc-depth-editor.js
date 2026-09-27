/* ============================================================
   TDC DEPTH EDITOR · owner-only "Edit depth chart" on the team page.
   Reorders the current roster (drag, or the ↑ ↓ buttons on touch), saves players.depth_order
   through the owner-only set_depth_chart() function (scripts/depth_chart_editor.sql), then
   starts the rebuild job so the player pages and rankings pick up the new minutes.
   The team page's own projection reads depth_order live, so it changes on the reload.
   The sheet sync keeps a website-edited team's order (sheet_sync.gs, depth_set_at).
============================================================ */
(function(){
  var SB = 'https://izlqhnxowdhtdofkwrho.supabase.co';
  var ANON = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
  var STARTERS = 5;

  function tok(){ try{ return window.tdcOwnerToken ? window.tdcOwnerToken() : null; }catch(e){ return null; } }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]; }); }
  function roster(){
    var r = (typeof teamPlayers !== 'undefined' && Array.isArray(teamPlayers)) ? teamPlayers : [];
    return r.filter(function(p){ return p && p.id != null && !p._fromHistory && p.name && p.name !== '—' && p.team; });
  }
  function current(){ return (typeof _rosterSeason === 'undefined') || +_rosterSeason >= 2027; }
  function grade(p){ var g = (p._projGrade != null) ? p._projGrade : parseFloat(p.tdc_grade); return isFinite(g) ? Math.round(g) : '—'; }

  function css(){
    if(document.getElementById('tdcDeCss')) return;
    var s = document.createElement('style'); s.id = 'tdcDeCss';
    s.textContent = [
      '.de-btn{font:600 11px Inter,system-ui,sans-serif;letter-spacing:.04em;background:var(--bg);border:1px solid var(--border2);color:var(--text2);padding:5px 11px;border-radius:999px;cursor:pointer}',
      '.de-btn:hover{color:var(--text);border-color:var(--text3)}',
      '.de-btn.pri{background:var(--text);color:var(--bg);border-color:var(--text)}',
      '.de-btn:disabled{opacity:.5;cursor:default}',
      '.de-ov{position:fixed;inset:0;z-index:400;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;padding:6vh 16px;overflow-y:auto}',
      '.de-pan{width:100%;max-width:560px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:10px;font-family:Inter,system-ui,sans-serif}',
      '.de-hd{padding:18px 20px 12px;border-bottom:1px solid var(--border)}',
      '.de-ey{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin-bottom:4px}',
      '.de-h{font:800 22px "Playfair Display",Georgia,serif;letter-spacing:-.01em}',
      '.de-sub{font-size:12.5px;color:var(--text3);margin-top:6px;line-height:1.5}',
      '.de-list{list-style:none;margin:0;padding:8px 12px}',
      '.de-sep{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);padding:10px 8px 4px}',
      '.de-row{display:grid;grid-template-columns:18px 26px 1fr 40px 44px 34px 58px;align-items:center;gap:6px;padding:6px 8px;border:1px solid var(--border);border-radius:8px;margin:4px 0;background:var(--bg);font-size:13px;cursor:grab;user-select:none}',
      '.de-row.drag{opacity:.4}',
      '.de-row.over{border-color:var(--accent);box-shadow:inset 0 2px 0 var(--accent)}',
      '.de-row .gr{color:var(--text3);letter-spacing:-1px}',
      '.de-row .n{font-weight:800;color:var(--text3);text-align:right}',
      '.de-row .nm{font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.de-row .dim{color:var(--text3);font-size:12px}',
      '.de-row .ov{font-weight:800;text-align:right}',
      '.de-row .mv{display:flex;gap:4px;justify-content:flex-end}',
      '.de-row .mv button{width:26px;height:24px;border:1px solid var(--border2);background:var(--bg);color:var(--text2);border-radius:6px;cursor:pointer;font-size:11px}',
      '.de-row .mv button:disabled{opacity:.3;cursor:default}',
      '.de-ft{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:12px 20px 18px;border-top:1px solid var(--border)}',
      '.de-ft .sp{flex:1}',
      '.de-st{font-size:12px;color:var(--text3);padding:0 20px 14px;min-height:16px}',
      '.de-st.err{color:#c75d5d}.de-st.ok{color:#3fa66a}',
      '@media(max-width:520px){.de-row{grid-template-columns:22px 1fr 34px 30px 58px}.de-row .gr,.de-row .yr{display:none}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  var order = [], ov = null;

  function rowHtml(p, i){
    return '<li class="de-row" draggable="true" data-i="' + i + '">'
      + '<span class="gr" aria-hidden="true">⋮⋮</span>'
      + '<span class="n">' + (i + 1) + '</span>'
      + '<span class="nm">' + esc(p.name) + '</span>'
      + '<span class="dim">' + esc(p.position || '') + '</span>'
      + '<span class="dim yr">' + esc(p.yr || p.class_year || '') + '</span>'
      + '<span class="ov">' + grade(p) + '</span>'
      + '<span class="mv"><button type="button" data-mv="-1" aria-label="Move ' + esc(p.name) + ' up"' + (i === 0 ? ' disabled' : '') + '>↑</button>'
      + '<button type="button" data-mv="1" aria-label="Move ' + esc(p.name) + ' down"' + (i === order.length - 1 ? ' disabled' : '') + '>↓</button></span>'
      + '</li>';
  }
  function paintList(){
    var ul = ov.querySelector('.de-list'), h = '';
    order.forEach(function(p, i){
      if(i === 0) h += '<li class="de-sep">Starters</li>';
      if(i === STARTERS) h += '<li class="de-sep">Bench</li>';
      h += rowHtml(p, i);
    });
    ul.innerHTML = h;
  }
  function move(from, to){
    if(to < 0 || to >= order.length || from === to) return;
    var p = order.splice(from, 1)[0]; order.splice(to, 0, p); paintList();
  }
  function status(msg, cls){ var s = ov && ov.querySelector('.de-st'); if(s){ s.className = 'de-st' + (cls ? ' ' + cls : ''); s.innerHTML = msg; } }
  function close(){ if(ov){ ov.remove(); ov = null; document.removeEventListener('keydown', onKey); } }
  function onKey(e){ if(e.key === 'Escape') close(); }

  function rpc(name, body){
    var t = tok(); if(!t) return Promise.reject(new Error('Sign in as the owner first.'));
    return fetch(SB + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { apikey: ANON, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function(r){ return r.text().then(function(x){
      var j = null; try{ j = JSON.parse(x); }catch(e){}
      if(!r.ok) throw new Error((j && (j.message || j.hint)) || ('HTTP ' + r.status));
      return j;
    }); });
  }
  function rebuild(){
    var t = tok(); if(!t) return Promise.resolve(false);
    return fetch(SB + '/functions/v1/rebuild-projections', {
      method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }
    }).then(function(r){ return r.json().then(function(j){ return !!(r.ok && j && j.ok); }); }).catch(function(){ return false; });
  }
  function busy(on){ ov.querySelectorAll('.de-ft button').forEach(function(b){ b.disabled = on; }); }

  function save(){
    var team = order[0].team;
    busy(true); status('Saving…');
    rpc('set_depth_chart', { p_team: team, p_ids: order.map(function(p){ return p.id; }) })
      .then(function(n){
        status('Saved ' + n + ' players. Starting the projection rebuild…');
        return rebuild().then(function(ok){
          status(ok ? '✓ Saved. This page reloads now; player pages and rankings update in about 2 minutes, then republish ratings.'
                    : '✓ Saved. The rebuild job did not start: run it from the owner console. Reloading…', 'ok');
          setTimeout(function(){ location.reload(); }, 2200);
        });
      })
      .catch(function(e){
        var m = (e && e.message) || String(e);
        if(/set_depth_chart|function/i.test(m) && /not find|does not exist|schema cache/i.test(m)) m = 'The depth chart function is not installed yet. Run scripts/depth_chart_editor.sql in Supabase.';
        status('✗ ' + esc(m), 'err'); busy(false);
      });
  }
  function reset(){
    var team = order[0].team;
    if(!confirm('Hand ' + team + ' back to the sheet? The next sheet sync will reset its depth chart to the sheet order.')) return;
    busy(true); status('Handing back to the sheet…');
    rpc('reset_depth_chart', { p_team: team })
      .then(function(){ status('✓ ' + esc(team) + ' follows the sheet again from the next sync.', 'ok'); busy(false); })
      .catch(function(e){ status('✗ ' + esc((e && e.message) || e), 'err'); busy(false); });
  }

  function open(){
    var r = roster(); if(!r.length) return;
    css();
    order = r.slice().sort(function(a, b){ return (a.depth_order || 999) - (b.depth_order || 999); });
    close();
    ov = document.createElement('div'); ov.className = 'de-ov';
    ov.innerHTML = '<div class="de-pan" role="dialog" aria-modal="true" aria-labelledby="deTitle">'
      + '<div class="de-hd"><div class="de-ey">Owner · Depth chart</div><div class="de-h" id="deTitle">' + esc(order[0].team) + '</div>'
      + '<div class="de-sub">Drag players into order, or use the arrows. The top five are the starters, and projected minutes follow this order. The sheet sync will keep it.</div></div>'
      + '<ol class="de-list"></ol><div class="de-st"></div>'
      + '<div class="de-ft"><button type="button" class="de-btn" data-act="reset">Hand back to sheet</button><span class="sp"></span>'
      + '<button type="button" class="de-btn" data-act="cancel">Cancel</button><button type="button" class="de-btn pri" data-act="save">Save depth chart</button></div></div>';
    document.body.appendChild(ov);
    paintList();
    ov.addEventListener('click', function(e){
      if(e.target === ov) return close();
      var a = e.target.closest('[data-act]');
      if(a){ if(a.dataset.act === 'cancel') close(); else if(a.dataset.act === 'save') save(); else if(a.dataset.act === 'reset') reset(); return; }
      var b = e.target.closest('[data-mv]');
      if(b){ var i = +b.closest('.de-row').dataset.i; move(i, i + (+b.dataset.mv));
        var nb = ov.querySelector('.de-row[data-i="' + (i + (+b.dataset.mv)) + '"] [data-mv="' + b.dataset.mv + '"]'); if(nb && !nb.disabled) nb.focus(); }
    });
    var from = -1;
    ov.addEventListener('dragstart', function(e){ var row = e.target.closest('.de-row'); if(!row) return; from = +row.dataset.i; row.classList.add('drag'); try{ e.dataTransfer.setData('text/plain', String(from)); e.dataTransfer.effectAllowed = 'move'; }catch(x){} });
    ov.addEventListener('dragover', function(e){ var row = e.target.closest('.de-row'); if(!row || from < 0) return; e.preventDefault();
      ov.querySelectorAll('.de-row.over').forEach(function(x){ x.classList.remove('over'); }); row.classList.add('over'); });
    ov.addEventListener('drop', function(e){ var row = e.target.closest('.de-row'); if(!row || from < 0) return; e.preventDefault(); var to = +row.dataset.i; var f = from; from = -1; move(f, to); });
    ov.addEventListener('dragend', function(){ from = -1; if(ov) ov.querySelectorAll('.de-row').forEach(function(x){ x.classList.remove('drag', 'over'); }); });
    document.addEventListener('keydown', onKey);
    var first = ov.querySelector('[data-act="save"]'); if(first) first.focus();
  }

  // Button in the Depth Chart heading: owner only, current roster only
  function attach(){
    var head = document.getElementById('depthSecHead'); if(!head) return;
    var btn = document.getElementById('deOpenBtn');
    var show = !!tok() && current() && roster().length > 0;
    if(!show){ if(btn) btn.style.display = 'none'; return; }
    css();
    if(!btn){
      btn = document.createElement('button'); btn.type = 'button'; btn.id = 'deOpenBtn'; btn.className = 'de-btn';
      btn.textContent = 'Edit depth chart'; btn.addEventListener('click', open);
      head.appendChild(btn);
    }
    btn.style.display = '';
  }
  window.TDCDepthEditor = { attach: attach, open: open };
  // auth.js may refresh the owner token just after load
  [800, 2500].forEach(function(ms){ setTimeout(attach, ms); });
})();
