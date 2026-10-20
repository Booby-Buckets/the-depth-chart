/* ============================================================
   TDC DEPTH EDITOR · owner-only "Edit depth chart" on the team page.
   Reorders the current roster (drag, or the ↑ ↓ buttons on touch), saves players.depth_order
   through the owner-only set_depth_chart() function (scripts/depth_chart_editor.sql), then
   starts the rebuild job so the player pages and rankings pick up the new minutes.
   The ORDER shows on the reload; the stat lines (minutes, points, every page) come from the rebuild,
   which takes ~5 minutes to run and deploy, so the numbers change only after that.
   The sheet sync keeps a website-edited team's order (sheet_sync.gs, depth_set_at).
   ADD PLAYER (Oct 20 2026, owner: "add players without re-running the sheet sync"): a form in the editor
   searches player_history by name (fills ESPN id, height, position, last school), then calls the owner-only
   add_roster_player() (scripts/roster_add_player.sql). The new player joins the bottom of the list; drag
   him into place and Save. Website-added rows carry site_added_at, so the sheet sync leaves them alone,
   and only those can be removed here (✕).
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
      '.de-row .x{border:none;background:none;color:var(--text3);cursor:pointer;font-size:13px;padding:0 2px}.de-row .x:hover{color:#c75d5d}',
      '.de-add{padding:12px 20px 4px;display:grid;grid-template-columns:1fr 1fr;gap:10px}',
      '.de-add label{display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--text3)}',
      '.de-add input,.de-add select{font:500 14px Inter,system-ui,sans-serif;padding:8px 10px;border:1px solid var(--border2);border-radius:8px;background:var(--bg);color:var(--text);text-transform:none;letter-spacing:0}',
      '.de-add .full{grid-column:1/-1}.de-add .chk{flex-direction:row;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:13px;font-weight:600;color:var(--text2)}',
      '.de-hits{grid-column:1/-1;border:1px solid var(--border);border-radius:8px;max-height:190px;overflow-y:auto;display:none}',
      '.de-hits button{display:flex;justify-content:space-between;gap:10px;width:100%;text-align:left;border:none;border-bottom:1px solid var(--border);background:var(--bg);color:var(--text);padding:8px 10px;font:500 13px Inter,system-ui,sans-serif;cursor:pointer}',
      '.de-hits button:hover{background:var(--bg2)}.de-hits button span{color:var(--text3);font-size:12px;white-space:nowrap}',
      '@media(max-width:520px){.de-row{grid-template-columns:22px 1fr 34px 30px 58px}.de-row .gr,.de-row .yr{display:none}.de-add{grid-template-columns:1fr}}'
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
      + '<span class="ov">' + (p.site_added_at ? '<button type="button" class="x" data-rm="' + i + '" title="Remove ' + esc(p.name) + ' (added on the website)">✕</button>' : '') + grade(p) + '</span>'
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
  function busy(on){ ov.querySelectorAll('.de-ft button, .de-add button').forEach(function(b){ b.disabled = on; }); }

  function save(){
    var team = order[0].team;
    busy(true); status('Saving…');
    rpc('set_depth_chart', { p_team: team, p_ids: order.map(function(p){ return p.id; }) })
      .then(function(n){
        status('Saved ' + n + ' players. Starting the projection rebuild…');
        return rebuild().then(function(ok){
          status(ok ? '✓ Saved. The new order shows on reload; the stat lines update in about 5–8 minutes, after the rebuild finishes and deploys.'
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

  // ── Add player ─────────────────────────────────────────────
  var POS = ['PG', 'SG', 'SF', 'PF', 'C'], CLS = ['Fr.', 'So.', 'Jr.', 'Sr.', 'Gr.'];
  function addForm(){
    var box = ov.querySelector('.de-addbox');
    if(box.innerHTML){ box.innerHTML = ''; return; }
    box.innerHTML = '<div class="de-add">'
      + '<label class="full">Name<input type="text" class="f-nm" autocomplete="off" placeholder="First Last"></label>'
      + '<div class="de-hits"></div>'
      + '<label>Position<select class="f-pos"><option value="">—</option>' + POS.map(function(x){ return '<option>' + x + '</option>'; }).join('') + '</select></label>'
      + '<label>Class<select class="f-cls"><option value="">—</option>' + CLS.map(function(x){ return '<option>' + x + '</option>'; }).join('') + '</select></label>'
      + '<label>Height<input type="text" class="f-ht" placeholder="6-5"></label>'
      + '<label>Previous school / hometown<input type="text" class="f-ht2"></label>'
      + '<label>ESPN id<input type="text" class="f-id" inputmode="numeric" placeholder="from the search, or blank"></label>'
      + '<label class="chk"><input type="checkbox" class="f-tr"> Transfer</label>'
      + '<label class="chk"><input type="checkbox" class="f-intl"> International</label>'
      + '<div class="full" style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="de-btn" data-act="addcancel">Cancel</button><button type="button" class="de-btn pri" data-act="addgo">Add to roster</button></div>'
      + '</div>';
    var nm = box.querySelector('.f-nm'), t = null;
    nm.addEventListener('input', function(){ clearTimeout(t); t = setTimeout(function(){ search(nm.value); }, 250); });
    box.scrollIntoView({ block: 'center' }); nm.focus({ preventScroll: true });
  }
  // past players with this name (player_history is public): fills ESPN id, height, position, last school
  function search(q){
    var hits = ov && ov.querySelector('.de-hits'); if(!hits) return;
    q = (q || '').trim(); if(q.length < 4){ hits.style.display = 'none'; return; }
    fetch(SB + '/rest/v1/player_history?name=ilike.*' + encodeURIComponent(q.replace(/[*,()]/g, ' ')) + '*&select=name,espn_id,team,season_year,position,height,yr&order=season_year.desc&limit=40', { headers: { apikey: ANON } })
      .then(function(r){ return r.ok ? r.json() : []; }).catch(function(){ return []; })
      .then(function(rows){
        var seen = {}, list = rows.filter(function(r){ var k = r.espn_id || (r.name + r.team); if(seen[k]) return false; seen[k] = 1; return true; }).slice(0, 8);
        if(!list.length){ hits.innerHTML = '<button type="button" disabled>No past college player by that name: a freshman? Fill in the rest by hand.</button>'; hits.style.display = 'block'; return; }
        hits.innerHTML = list.map(function(r, k){ return '<button type="button" data-hit="' + k + '">' + esc(r.name) + '<span>' + esc(r.team) + ' · ' + (r.season_year - 1) + '-' + String(r.season_year).slice(2) + (r.position ? ' · ' + esc(r.position) : '') + (r.height ? ' · ' + esc(r.height) : '') + '</span></button>'; }).join('');
        hits.style.display = 'block';
        hits.querySelectorAll('[data-hit]').forEach(function(b){ b.addEventListener('click', function(){ pick(list[+b.dataset.hit]); }); });
      });
  }
  var NEXT = { 'Fr.': 'So.', 'So.': 'Jr.', 'Jr.': 'Sr.', 'Sr.': 'Gr.', 'Gr.': 'Gr.' };
  function pick(r){
    var box = ov.querySelector('.de-add'), team = order[0].team, q = function(c){ return box.querySelector(c); };
    q('.f-nm').value = r.name; q('.f-id').value = r.espn_id || '';
    if(r.height) q('.f-ht').value = r.height;
    var pos = String(r.position || '').toUpperCase(); pos = { G: 'SG', F: 'SF', 'G-F': 'SF', 'F-G': 'SF', 'F-C': 'PF', 'C-F': 'C' }[pos] || pos;
    if(POS.indexOf(pos) >= 0) q('.f-pos').value = pos;
    var yr = String(r.yr || '').replace(/^R-/, ''); if(NEXT[yr]) q('.f-cls').value = NEXT[yr];   // his class this season = one step on
    var moved = r.team && r.team !== team; q('.f-tr').checked = !!moved; if(moved) q('.f-ht2').value = r.team;
    ov.querySelector('.de-hits').style.display = 'none';
  }
  function addGo(){
    var box = ov.querySelector('.de-add'), q = function(c){ return box.querySelector(c); }, team = order[0].team;
    var name = q('.f-nm').value.trim(), id = q('.f-id').value.trim();
    if(name.length < 3) return status('✗ Enter the player\u2019s full name.', 'err');
    if(id && !/^\d+$/.test(id)) return status('✗ The ESPN id is a number (leave it blank for a freshman).', 'err');
    busy(true); status('Adding ' + esc(name) + '…');
    rpc('add_roster_player', { p_team: team, p_name: name, p_position: q('.f-pos').value || null, p_class: q('.f-cls').value || null,
      p_height: q('.f-ht').value.trim() || null, p_hometown: q('.f-ht2').value.trim() || null, p_espn_id: id ? +id : null,
      p_transfer: q('.f-tr').checked, p_international: q('.f-intl').checked })
      .then(function(newId){
        order.push({ id: newId, name: name, team: team, position: q('.f-pos').value, yr: q('.f-cls').value, site_added_at: new Date().toISOString(), _projGrade: null });
        ov.querySelector('.de-addbox').innerHTML = ''; paintList(); busy(false);
        status('✓ ' + esc(name) + ' added at the bottom. Drag him into place, then Save depth chart to update the projections.', 'ok');
      })
      .catch(function(e){
        var m = (e && e.message) || String(e);
        if(/add_roster_player|function/i.test(m) && /not find|does not exist|schema cache/i.test(m)) m = 'The add-player function is not installed yet. Run scripts/roster_add_player.sql in Supabase.';
        status('✗ ' + esc(m), 'err'); busy(false);
      });
  }
  function removeAt(i){
    var p = order[i]; if(!p || !confirm('Remove ' + p.name + ' from ' + p.team + '?')) return;
    busy(true); status('Removing…');
    rpc('remove_roster_player', { p_id: p.id })
      .then(function(){ order.splice(i, 1); paintList(); busy(false); status('✓ Removed ' + esc(p.name) + '. Save depth chart to update the projections.', 'ok'); })
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
      + '<ol class="de-list"></ol><div class="de-addbox"></div><div class="de-st"></div>'
      + '<div class="de-ft"><button type="button" class="de-btn" data-act="add">+ Add player</button><button type="button" class="de-btn" data-act="reset">Hand back to sheet</button><span class="sp"></span>'
      + '<button type="button" class="de-btn" data-act="cancel">Cancel</button><button type="button" class="de-btn pri" data-act="save">Save depth chart</button></div></div>';
    document.body.appendChild(ov);
    paintList();
    ov.addEventListener('click', function(e){
      if(e.target === ov) return close();
      var a = e.target.closest('[data-act]');
      if(a){ var act = a.dataset.act;
        if(act === 'cancel') close(); else if(act === 'save') save(); else if(act === 'reset') reset();
        else if(act === 'add' || act === 'addcancel') addForm(); else if(act === 'addgo') addGo();
        return; }
      var rm = e.target.closest('[data-rm]'); if(rm){ removeAt(+rm.dataset.rm); return; }
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
