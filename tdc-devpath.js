/* tdc-devpath.js — Player Development for ONE player, as a shared module.
   His season-by-season TDC-grade trajectory (from scripts/data/development.json, the same
   file the league-wide development page reads): five summary tiles + a sheet of every graded
   season (Season / Class / School / Conference / grade / Δ) with transfer markers and the
   career-peak row highlighted. Renders into any host — the in-page Coach's Tier tab.

   TDC_DEVPATH.renderPlayer(host, { espn_id, name })
   CSS scoped under .tdcdv; uses tdc-sheets.css for the table. */
window.TDC_DEVPATH = (function(){
  let DATA=null;
  const esc=s=>(''+(s==null?'':s)).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]);
  async function ensureData(){ if(DATA) return DATA; try{ DATA=await fetch('scripts/data/development.json').then(r=>r.ok?r.json():null); }catch(e){ DATA=null; } return DATA; }
  function ensureCss(){
    if(document.getElementById('tdcdv-css')) return;
    const s=document.createElement('style'); s.id='tdcdv-css';
    s.textContent=`
.tdcdv{font-family:'Inter',system-ui,sans-serif;}
.tdcdv .dv-h{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text2);margin:0 0 12px;display:flex;align-items:center;gap:10px;}
.tdcdv .dv-h .hint{font-weight:600;letter-spacing:0;text-transform:none;color:var(--text3);font-size:11px;}
.tdcdv .dv-h::after{content:'';flex:1;height:1px;background:var(--border);}
.tdcdv .dv-tiles{display:grid;grid-template-columns:repeat(5,1fr);gap:0;border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--bg2);margin:0 0 14px;}
.tdcdv .dv-tile{padding:12px 14px;border-right:1px solid var(--border);}
.tdcdv .dv-tile:last-child{border-right:none;}
.tdcdv .dv-tile .v{font-family:'Sora','Inter',sans-serif;font-weight:800;font-size:24px;line-height:1;color:var(--text);font-variant-numeric:tabular-nums;}
.tdcdv .dv-tile .l{font-size:9.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--text3);margin-top:6px;}
.tdcdv .dv-tile .s{font-size:10.5px;color:var(--text3);margin-top:2px;}
.tdcdv .sheet-wrap{max-height:none;box-shadow:none;}
.tdcdv .sheet{width:100%;}
.tdcdv .note{font-size:11px;color:var(--text3);line-height:1.6;margin-top:10px;}
.tdcdv .muted{font-size:12.5px;color:var(--text2);padding:14px 16px;border:1px dashed var(--border);border-radius:10px;line-height:1.5;}
.tdcdv .loading{padding:26px;text-align:center;color:var(--text3);font-size:13px;}
@media(max-width:760px){ .tdcdv .dv-tiles{grid-template-columns:repeat(2,1fr);} .tdcdv .dv-tile{border-bottom:1px solid var(--border);} .tdcdv .dv-tile:nth-child(odd){border-right:1px solid var(--border);} }`;
    document.head.appendChild(s);
  }
  async function renderPlayer(host, ctx){
    ensureCss(); host.classList.add('tdcdv');
    host.innerHTML='<div class="loading">Tracing his development…</div>';
    const D=await ensureData();
    if(!D||!D.players){ host.innerHTML='<div class="muted">Development data is not available right now.</div>'; return; }
    const wantEspn=ctx.espn_id!=null?String(ctx.espn_id):null, wantName=(ctx.name||'').toLowerCase().trim();
    const p=(D.players||[]).find(x=>(wantEspn&&String(x[0])===wantEspn)||(wantName&&String(x[1]||'').toLowerCase().trim()===wantName));
    if(!p||!(p[2]||[]).length){
      host.innerHTML=`<div class="muted"><b style="color:var(--text);">No development file yet for ${esc(ctx.name||'this player')}.</b> The trajectory needs at least two graded D-I seasons on record; it appears here once a second season is in.</div>`; return;
    }
    const confName=ci=>ci>=0&&D.conferences[ci]?D.conferences[ci].name:null, schoolName=si=>si>=0&&D.schools[si]?D.schools[si]:'';
    const cls=i=>['Fr','So','Jr','Sr','5th','6th'][i]||('Yr '+(i+1));
    const ss=p[2], first=ss[0], last=ss[ss.length-1]; let peak=ss[0]; for(let i=1;i<ss.length;i++){ if(ss[i][1]>peak[1]) peak=ss[i]; }
    const rows=ss.map((s,i)=>{ const prev=i?ss[i-1]:null, d=prev?(s[1]-prev[1]):null;
      const dTxt=d==null?'<span class="dim">—</span>':(d===0?'<span class="dim">±0</span>':`<span style="color:${d>0?'var(--green)':'var(--red)'};font-weight:800;">${d>0?'+':''}${d}</span>`);
      const moved=prev&&s[3]!==prev[3]&&s[3]>=0&&prev[3]>=0;
      return `<tr${s===peak?' style="background:color-mix(in srgb,var(--accent) 10%,transparent)"':''}><td class="c">${s[0]-1}–${String(s[0]).slice(2)}</td><td class="c dim">${cls(i)}</td><td class="l nm">${esc(schoolName(s[3]))}${moved?' <span style="font-size:10px;color:var(--accent);font-weight:800;">↗ transfer</span>':''}</td><td class="l dim">${esc(confName(s[2])||'')}</td><td style="font-weight:800;color:var(--text);">${s[1]}</td><td>${dTxt}</td></tr>`; }).join('');
    const gain=peak[1]-first[1]; let bestJ=0,bestJs=null; for(let j=1;j<ss.length;j++){ const dj=ss[j][1]-ss[j-1][1]; if(ss[j][0]===ss[j-1][0]+1&&dj>bestJ){bestJ=dj;bestJs=ss[j];} }
    const tile=(v,l,sub)=>`<div class="dv-tile"><div class="v">${v}</div><div class="l">${l}</div>${sub?`<div class="s">${sub}</div>`:''}</div>`;
    const yr=s=>(s[0]-1)+'–'+String(s[0]).slice(2);
    host.innerHTML=`<div class="dv-h">Development <span class="hint">his graded seasons, first to latest</span></div>
      <div class="dv-tiles">${tile(first[1],'First graded season',yr(first))}${tile(peak[1],'Career peak',yr(peak)+' · '+esc(schoolName(peak[3])))}${tile((gain>0?'+':'')+gain,'First → peak','grade points')}${tile(bestJs?('+'+bestJ):'—','Best single-season jump',bestJs?yr(bestJs):'')}${tile(last[1],'Latest grade',yr(last))}</div>
      <div class="sheet-wrap"><table class="sheet"><thead><tr><th class="c">Season</th><th class="c">Class</th><th class="l">School</th><th class="l">Conference</th><th>TDC grade</th><th>Δ vs prior</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="note">Highlighted row = career peak. Δ is the year-over-year change in his TDC grade; a ↗ marks a school change. <a href="development.html?espn=${encodeURIComponent(p[0])}" style="color:var(--accent);font-weight:700;">See him against the league-wide curve →</a></div>`;
  }
  return { renderPlayer };
})();
