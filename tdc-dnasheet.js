/* tdc-dnasheet.js — Team DNA as one spreadsheet (owner's pick "A · The Sheet", Oct 2026).
   Every stat is a row: this season, its rank, last season, its rank, the D-I average and an
   in-cell bar (centre tick = D-I median). Cells are shaded red→green (tdc-sheets .c0-.c4) by how
   GOOD the value is for the team; style rows (how often they take a shot type, tempo) are left
   unshaded because more or fewer isn't better or worse.

   TDC_DNASHEET.team(host, {key, season, name})          one team, offense + defense sheets
   TDC_DNASHEET.versus(host, {a, b, season, nameA, nameB}) two teams, each offense vs the other's defense
   TDC_DNASHEET.data()                                   resolves the shared data (team_dna.json etc.)

   key / a / b = the ESPN full name team_dna.json uses ("Duke Blue Devils"). season = a team_dna
   season key ("2027" = projected 2026-27). Play-log rows (shot zones, possession starts, shot
   clock, situations) come from scripts/data/shot_aftermath/{tprof,poss,sit}_<y>.json, keyed by
   ESPN team id (mapped through team_colors.json); a projected season has no play log, so those
   rows show last season only. Shot quality comes from shot_genome_teams[_<y>].json and, for the
   projection, shot_genome_projected.json (offense only). No DOM outside `host`, no Supabase. */
(function(){
  var J={}, IDS=null, DNA=null;
  function getJ(u){ if(!J[u]) J[u]=fetch(u).then(function(r){ return r.ok?r.json():null; }).catch(function(){ return null; }); return J[u]; }
  function ids(){ if(IDS) return IDS; IDS=getJ('scripts/data/team_colors.json').then(function(a){ var m={}; (a||[]).forEach(function(e){ if(e&&e.display&&e.id!=null) m[e.display]=String(e.id); }); return m; }); return IDS; }
  function dna(){ if(!DNA) DNA=getJ('scripts/data/team_dna.json'); return DNA; }
  function play(y){ y=+y; if(!(y>=2010&&y<=2026)) return Promise.resolve(null);
    return Promise.all([getJ('scripts/data/shot_aftermath/tprof_'+y+'.json'),getJ('scripts/data/shot_aftermath/poss_'+y+'.json'),getJ('scripts/data/shot_aftermath/sit_'+y+'.json')])
      .then(function(r){ return (r[0]||r[1]||r[2])?{tp:r[0],ps:r[1],st:r[2]}:null; }); }
  function genome(y){ y=+y;
    if(y===2027) return getJ('scripts/data/shot_genome_projected.json?v=1').then(function(d){ var m={}, s=d&&d['2027']; if(s) Object.keys(s).forEach(function(k){ m[k]=s[k]; }); return m; });
    if(!(y>=2020&&y<=2026)) return Promise.resolve(null);
    return getJ('scripts/data/shot_genome_teams'+(y===2026?'':'_'+y)+'.json').then(function(d){ var m={}; ((d&&d.teams)||[]).forEach(function(t){ m[t.team]=t; }); return m; }); }
  function slbl(s){ s=+s; return (s-1)+'-'+String(s).slice(2)+(s===2027?' proj':''); }
  function ord(n){ var s=['th','st','nd','rd'],v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function tip(k){ return (k&&window.tipAttr)?window.tipAttr(k):''; }

  // ── one season's context: every team's values for every row, so ranks are honest ──
  function Ctx(season, D, P, G, IDM){
    this.season=String(season); this.S=D&&D[this.season]; this.P=P; this.G=G; this.IDM=IDM||{};
    this.proj=!!(this.S&&this.S.meta&&this.S.meta.projected);
  }
  Ctx.prototype.team=function(key){ return this.S&&this.S.teams?this.S.teams[key]:null; };
  // play-log rows for one team id, with a "real D-I team" floor (half the median possessions)
  Ctx.prototype.pool=function(){ if(this._pool) return this._pool; var P=this.P, pool={tp:{},ps:{},st:{}};
    if(P&&P.tp){ ['off','def'].forEach(function(sd){ var vs=Object.keys(P.tp[sd]).map(function(k){ return P.tp[sd][k][1]; }).sort(function(a,b){return a-b;}); var floor=(vs[vs.length>>1]||0)/2;
      pool.tp[sd]={}; Object.keys(P.tp[sd]).forEach(function(k){ if(P.tp[sd][k][1]>=floor) pool.tp[sd][k]=P.tp[sd][k]; }); }); }
    if(P&&P.ps){ var sum=function(o){ var n=0; Object.keys(o||{}).forEach(function(k){ n+=o[k][0]; }); return n; };
      var vs=Object.keys(P.ps.teams).map(function(k){ return sum(P.ps.teams[k].off&&P.ps.teams[k].off.st); }).sort(function(a,b){return a-b;}); var floor=(vs[vs.length>>1]||0)/2;
      Object.keys(P.ps.teams).forEach(function(k){ if(sum(P.ps.teams[k].off&&P.ps.teams[k].off.st)>=floor){ pool.ps[k]=P.ps.teams[k]; if(P.st&&P.st.teams[k]) pool.st[k]=P.st.teams[k]; } }); }
    return (this._pool=pool); };

  // ── the row catalogue ── v(c, key, id) → number|null; pool(c) → [all teams' values]; hi: true/false = quality, null = style
  var ADJ=function(t,a,r){ return t?(t[a]!=null?t[a]:t[r]):null; };
  function dnaRow(l,k,hi,f,t,adj){ return {l:l,hi:hi,f:f,tip:t,src:'dna',
    v:function(c,key){ var x=c.team(key); return x?(adj&&!c.proj?ADJ(x,adj,k):x[k]):null; },
    pool:function(c){ if(!c.S) return []; return Object.keys(c.S.teams).map(function(n){ var x=c.S.teams[n]; return adj&&!c.proj?ADJ(x,adj,k):x[k]; }); },
    avg:true}; }
  // tprof cols: games,poss,fta,ftm,rimA,rimM,midA,midM,threeA,threeM
  function zr(sd,i){ return function(a){ return a&&a[1]?100*a[i]/a[1]:null; }; }
  function za(sd,i,j){ return function(a){ return a&&a[i]?100*a[j]/a[i]:null; }; }
  function tpRow(l,sd,fn,hi,f,t,lg){ return {l:l,hi:hi,rlo:sd==='def',f:f,tip:t,src:'tp',
    v:function(c,key,id){ var p=c.pool().tp[sd]; return p&&id&&p[id]?fn(p[id]):null; },
    pool:function(c){ var p=c.pool().tp[sd]; return p?Object.keys(p).map(function(k){ return fn(p[k]); }):[]; },
    lg:function(c){ var p=c.P&&c.P.tp&&c.P.tp[sd]; if(!p) return null; var T=new Array(10).fill(0); Object.keys(p).forEach(function(k){ p[k].forEach(function(v,i){ T[i]+=v; }); }); return fn(T); }}; }
  function ppRow(l,sd,g,k,hi,t){ return {l:l,hi:hi,f:'ppp',tip:t,src:'ps',n:function(c,id){ var x=c.pool().ps[id]; x=x&&x[sd]&&x[sd][g]&&x[sd][g][k]; return x?x[0]:null; },
    v:function(c,key,id){ var x=c.pool().ps[id]; x=x&&x[sd]&&x[sd][g]&&x[sd][g][k]; return x&&x[0]?x[1]/x[0]:null; },
    pool:function(c){ var p=c.pool().ps; return Object.keys(p).map(function(i){ var x=p[i][sd]&&p[i][sd][g]&&p[i][sd][g][k]; return x&&x[0]>=8?x[1]/x[0]:null; }); },
    lg:function(c){ var L=c.P&&c.P.ps&&c.P.ps.league&&c.P.ps.league[g]&&c.P.ps.league[g][k]; return L&&L[0]?L[1]/L[0]:null; }}; }
  function stGet(x,sd,ks){ if(!x||!x[sd]) return null; var n=0,p=0; ks.forEach(function(k){ var a=x[sd][k]; if(a){ n+=a[0]; p+=a[1]; } }); return n?[n,p]:null; }
  function stRow(l,sd,ks,hi,t){ return {l:l,hi:hi,f:'ppp',tip:t,src:'st',n:function(c,id){ var x=stGet(c.pool().st[id],sd,ks); return x?x[0]:null; },
    v:function(c,key,id){ var x=stGet(c.pool().st[id],sd,ks); return x?x[1]/x[0]:null; },
    pool:function(c){ var p=c.pool().st; return Object.keys(p).map(function(i){ var x=stGet(p[i],sd,ks); return x&&x[0]>=8?x[1]/x[0]:null; }); },
    lg:function(c){ var L=c.P&&c.P.st&&c.P.st.league&&c.P.st.league.sit; if(!L) return null; var n=0,p=0; ks.forEach(function(k){ if(L[k]){ n+=L[k][0]; p+=L[k][1]; } }); return n?p/n:null; }}; }
  function sgRow(l,sd,k,hi,f,t){ return {l:l,hi:hi,f:f,tip:t,src:'sg',
    v:function(c,key){ var x=c.G&&c.G[key]; x=x&&x[sd]; return x&&x[k]!=null?x[k]:null; },
    pool:function(c){ return c.G?Object.keys(c.G).map(function(n){ var x=c.G[n][sd]; return x?x[k]:null; }):[]; }, avg:true}; }

  var OFF=[
    ['Efficiency',[dnaRow('Offensive rating','ORtg',true,1,'ortg','adjO'),dnaRow('Net efficiency','net',true,'+','neteff','adjNet'),dnaRow('Tempo','tempo',null,1,'tempo')]],
    ['Four factors',[dnaRow('Effective FG%','oeFG',true,1,'efg'),dnaRow('Turnover rate','oTOV',false,1,'tov'),dnaRow('Off. rebound rate','oORB',true,1,'orb'),dnaRow('Free-throw rate','oFTr',true,1,'ftr')]],
    ['Shot quality',[sgRow('Look quality','off','lq',true,1,'lookq'),sgRow('Shot-making (SM+)','off','smAdj',true,'+','smplus')]],
    ['Shot zones · per 100 possessions',[tpRow('Rim attempts','off',zr('off',4),null,1),tpRow('Rim FG%','off',za('off',4,5),true,1),tpRow('Mid-range attempts','off',zr('off',6),null,1),tpRow('Mid-range FG%','off',za('off',6,7),true,1),
      tpRow('3PT attempts','off',zr('off',8),null,1),tpRow('3PT%','off',za('off',8,9),true,1),tpRow('FT%','off',za('off',2,3),true,1)]],
    ['Points per possession · how it started',[ppRow('After a defensive rebound','off','st','dr',true),ppRow('After a made basket','off','st','fg',true),ppRow('After a turnover','off','st','to',true),ppRow('After made free throws','off','st','ft',true)]],
    ['Points per possession · shot clock',[ppRow('Shot in 0-10 s','off','tm','tr',true),ppRow('Shot in 11-20 s','off','tm','early',true),ppRow('Shot in 21-30 s','off','tm','half',true),ppRow('Shot after 30 s','off','tm','late',true)]],
    ['Points per possession · situations',[stRow('Out of their own timeout','off',['ato'],true),stRow('Out of a media timeout','off',['tvto'],true),stRow('First 4:00 of the game','off',['start1'],true),stRow('First 4:00 of the 2nd half','off',['start2'],true),
      stRow('Last 4:00, within 5','off',['close'],true),stRow('Right after an 8-0 run against','off',['afterrun'],true),stRow('In the bonus','off',['bonus1','bonus2'],true)]],
  ];
  var DEF=[
    ['Efficiency',[dnaRow('Defensive rating','DRtg',false,1,'drtg','adjD')]],
    ['Four factors',[dnaRow('Opp. effective FG%','deFG',false,1,'efg'),dnaRow('Forced turnover rate','dTOV',true,1,'tov'),dnaRow('Def. rebound rate','dDRB',true,1,'drb'),dnaRow('Opp. free-throw rate','dFTr',false,1,'ftr')]],
    ['Shot quality allowed',[sgRow('Look quality allowed','def','lq',false,1,'lookq'),sgRow('Opp. shot-making (SM+)','def','smAdj',false,'+','smplus')]],
    ['Shot zones allowed · per 100 possessions',[tpRow('Rim attempts allowed','def',zr('def',4),null,1),tpRow('Opp. rim FG%','def',za('def',4,5),false,1),tpRow('Mid-range allowed','def',zr('def',6),null,1),tpRow('Opp. mid-range FG%','def',za('def',6,7),false,1),
      tpRow('3PT attempts allowed','def',zr('def',8),null,1),tpRow('Opp. 3PT%','def',za('def',8,9),false,1),tpRow('Opp. FT%','def',za('def',2,3),false,1)]],
    ['Points allowed per possession · how it started',[ppRow('After their defensive rebound','def','st','dr',false),ppRow('After their made basket','def','st','fg',false),ppRow('After their turnover','def','st','to',false),ppRow('After their made free throws','def','st','ft',false)]],
    ['Points allowed per possession · shot clock',[ppRow('Shot in 0-10 s','def','tm','tr',false),ppRow('Shot in 11-20 s','def','tm','early',false),ppRow('Shot in 21-30 s','def','tm','half',false),ppRow('Shot after 30 s','def','tm','late',false)]],
    ['Points allowed per possession · situations',[stRow('Out of the opponent\'s timeout','def',['ato'],false),stRow('Out of a media timeout','def',['tvto'],false),stRow('First 4:00 of the game','def',['start1'],false),stRow('First 4:00 of the 2nd half','def',['start2'],false),
      stRow('Last 4:00, within 5','def',['close'],false),stRow('Right after their 8-0 run','def',['afterrun'],false),stRow('Opponent in the bonus','def',['bonus1','bonus2'],false)]],
  ];

  // rank (1 = best for quality rows, 1 = most for style rows) + goodness percentile 0-100
  function rk(row,c,v){ if(v==null) return null; var xs=row.pool(c).filter(function(x){ return x!=null&&isFinite(x); }); if(xs.length<20) return null;
    var hi=row.hi===null?!row.rlo:row.hi!==false, better=xs.filter(function(x){ return hi?x>v:x<v; }).length, n=xs.length;
    var r=better+1; return {r:r,n:n,p:Math.round(100*(n-r)/Math.max(1,n-1))}; }
  function avg(row,c){ if(row.lg) return row.lg(c); var xs=row.pool(c).filter(function(x){ return x!=null&&isFinite(x); }); return xs.length?xs.reduce(function(s,x){return s+x;},0)/xs.length:null; }
  function fmt(v,f){ if(v==null||!isFinite(v)) return '—'; if(f==='ppp') return v.toFixed(2); if(f==='+') return (v>0?'+':v<0?'−':'')+Math.abs(v).toFixed(1); return v.toFixed(1); }
  function cb(p){ return p>=80?'c4':p>=60?'c3':p>=40?'c2':p>=20?'c1':'c0'; }
  function bar(p){ return '<span class="dsx-bar"><i style="width:'+Math.max(2,Math.min(100,p))+'%"></i><b></b></span>'; }

  function css(){ if(document.getElementById('dsx-css')) return; var s=document.createElement('style'); s.id='dsx-css'; s.textContent=[
    '.dsx{--dsx-ink:#1A2A4C;}',
    ':root[data-theme="dark"] .dsx{--dsx-ink:#8fa8dc;}',
    '.dsx-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,520px),1fr));gap:18px;align-items:start;}',
    '.dsx-cols>*{min-width:0;}',
    '.dsx-h{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text2);margin:0 0 6px;}',
    '.dsx-h span{font-weight:600;letter-spacing:0;text-transform:none;color:var(--text3);}',
    '.dsx-h .dsx-logo{width:18px;height:18px;object-fit:contain;vertical-align:-4px;margin-right:6px;}',
    '.dsx .sheet{width:100%;min-width:0;}',
    '.dsx .sheet-wrap{max-height:none;}',
    '.dsx .sheet thead th{position:static;}',
    '.dsx .sheet td,.dsx .sheet th{padding:6px 9px;}',
    '.dsx .sheet tr.dsx-g td{background:var(--bg3)!important;background-image:none!important;font-size:9.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text2);text-align:left;padding:5px 9px;}',
    '.dsx .sheet td.dsx-l{text-align:left;color:var(--text);white-space:nowrap;}',
    '.dsx .sheet td.dsx-l small{color:var(--text3);font-weight:500;margin-left:5px;font-size:10.5px;}',
    '.dsx .sheet td.dsx-r{color:var(--text3);font-size:11.5px;}',
    '.dsx .sheet td.dsx-a{color:var(--text3);}',
    '.dsx .sheet td.dsx-s{font-style:normal;}',
    '.dsx-bar{position:relative;display:inline-block;width:92px;height:8px;background:var(--bg3);border-radius:2px;vertical-align:middle;}',
    '.dsx-bar i{position:absolute;left:0;top:0;bottom:0;background:var(--dsx-ink);border-radius:2px;opacity:.85;}',
    '.dsx-bar b{position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:var(--text3);}',
    '.dsx-edge{position:relative;display:inline-block;width:96px;height:10px;vertical-align:middle;background:linear-gradient(90deg,transparent calc(50% - .5px),var(--border2) calc(50% - .5px),var(--border2) calc(50% + .5px),transparent calc(50% + .5px));}',
    '.dsx-edge i{position:absolute;top:1px;bottom:1px;border-radius:2px;}',
    '.dsx-leg{display:flex;gap:12px;flex-wrap:wrap;align-items:center;font-size:11px;color:var(--text3);margin-top:8px;}',
    '.dsx-leg i{display:inline-block;width:14px;height:10px;border-radius:2px;vertical-align:-1px;margin-right:4px;}',
    '@media(max-width:640px){.dsx-bar{width:56px;}.dsx-edge{width:64px;}.dsx .sheet td,.dsx .sheet th{padding:5px 6px;}.dsx .sheet td.dsx-l small{display:none;}}'
  ].join('\n'); document.head.appendChild(s); }

  function data(season){ var s=+season, prev=s-1;
    return Promise.all([dna(),ids(),play(s),play(prev),genome(s),genome(prev)]).then(function(r){
      return {D:r[0],IDM:r[1],cur:new Ctx(s,r[0],r[2],r[4],r[1]),prev:new Ctx(prev,r[0],r[3],r[5],r[1])}; }); }

  // ── one team ──
  function sheet(groups, X, key, id, cols){
    var h='<div class="sheet-wrap"><table class="sheet dense"><thead><tr><th class="l">Stat</th>'+cols.map(function(c){ return '<th>'+c.lb+'</th><th>Rk</th>'; }).join('')+'<th>D-I</th><th class="l">vs D-I</th></tr></thead><tbody>';
    var any=false;
    groups.forEach(function(g){
      var body='';
      g[1].forEach(function(row){
        var cells=cols.map(function(c){ var v=row.v(c.ctx,key,id); return {v:v,k:v!=null?rk(row,c.ctx,v):null,ctx:c.ctx}; });
        if(cells.every(function(x){ return x.v==null; })) return;
        var lead=cells.filter(function(x){ return x.v!=null; })[0];
        var a=avg(row,lead.ctx), n=row.n?row.n(lead.ctx,id):null;
        body+='<tr><td class="dsx-l"'+tip(row.tip)+'>'+row.l+(n!=null?'<small>'+n+' poss</small>':'')+'</td>'+cells.map(function(x){
          var cl=(x.k&&row.hi!=null)?cb(x.k.p):''; return '<td class="'+cl+'">'+fmt(x.v,row.f)+'</td><td class="dsx-r">'+(x.k?ord(x.k.r):'')+'</td>'; }).join('')+
          '<td class="dsx-a">'+fmt(a,row.f)+'</td><td class="l">'+(lead.k?bar(row.hi==null?lead.k.p:lead.k.p):'')+'</td></tr>';
      });
      if(body){ any=true; h+='<tr class="dsx-g"><td colspan="'+(cols.length*2+3)+'">'+g[0]+'</td></tr>'+body; }
    });
    return any?h+'</tbody></table></div>':'';
  }
  function legend(){ return '<div class="dsx-leg"><span><i style="background:hsla(0,70%,48%,.34)"></i>bottom fifth of D-I</span><span><i style="background:hsla(95,70%,48%,.15)"></i>middle</span><span><i style="background:hsla(125,70%,48%,.40)"></i>top fifth</span><span>Shading is good-for-this-team. Unshaded rows are style, not quality: rank 1 takes the most of that shot, or allows the fewest. Bar = D-I percentile, tick = median.</span></div>'; }

  function team(host, o){ css(); if(!host) return Promise.resolve();
    return data(o.season).then(function(R){
      var C=R.cur, Pv=R.prev, id=R.IDM[o.key]||null;
      var cols=[]; if(C.team(o.key)||(C.P&&id)) cols.push({lb:slbl(C.season),ctx:C}); if(Pv.S&&(Pv.team(o.key)||(Pv.P&&id))) cols.push({lb:slbl(Pv.season),ctx:Pv});
      if(!cols.length){ host.innerHTML='<div class="dsx-empty" style="padding:20px;color:var(--text3)">No team profile on file for this season.</div>'; return; }
      var off=sheet(OFF,R,o.key,id,cols), def=sheet(DEF,R,o.key,id,cols);
      host.innerHTML='<div class="dsx"><div class="dsx-cols"><div><div class="dsx-h">Offense <span>rank among D-I teams</span></div>'+off+'</div><div><div class="dsx-h">Defense <span>green = good for '+esc(o.name||'this team')+'</span></div>'+def+'</div></div>'+legend()+'</div>';
    }); }

  // ── two teams: each offense against the other's defense ──
  var VS=[
    ['Efficiency',[[OFF[0][1][0],DEF[0][1][0],'Off. rating · def. rating']]],
    ['Four factors',[[OFF[1][1][0],DEF[1][1][0],'Effective FG% · allowed'],[OFF[1][1][1],DEF[1][1][1],'Turnover rate · forced'],[OFF[1][1][2],DEF[1][1][2],'Off. reb. rate · def. reb. rate'],[OFF[1][1][3],DEF[1][1][3],'Free-throw rate · allowed']]],
    ['Shot quality',[[OFF[2][1][0],DEF[2][1][0],'Look quality · allowed'],[OFF[2][1][1],DEF[2][1][1],'Shot-making (SM+) · allowed']]],
    ['Shot zones · per 100 possessions',OFF[3][1].map(function(r,i){ return [r,DEF[3][1][i]]; })],
    ['Points per possession · how it started',OFF[4][1].map(function(r,i){ return [r,DEF[4][1][i]]; })],
    ['Points per possession · shot clock',OFF[5][1].map(function(r,i){ return [r,DEF[5][1][i]]; })],
  ];
  function vsSheet(R, kO, kD, nO, nD, colO, colD){
    var idO=R.IDM[kO], idD=R.IDM[kD];
    var lo=window.tdcTeamColor&&tdcTeamColor(kO), ld=window.tdcTeamColor&&tdcTeamColor(kD);
    var img=function(l){ return l&&l.logo?'<img class="dsx-logo" src="'+l.logo+'" alt="">':''; };
    var h='<div class="sheet-wrap"><table class="sheet dense"><thead><tr><th class="l">Stat</th><th>'+esc(nO)+'</th><th>Rk</th><th>'+esc(nD)+'</th><th>Rk</th><th>D-I</th><th class="c">Edge</th></tr></thead><tbody>';
    VS.forEach(function(g){ var body='';
      g[1].forEach(function(pr){ var ro=pr[0], rd=pr[1];
        var ctxO=ro.src==='dna'?R.dnaCtx:ro.src==='sg'?R.sgCtx:R.playCtx, ctxD=ctxO; if(!ctxO) return;
        var vo=ro.v(ctxO,kO,idO), vd=rd.v(ctxD,kD,idD); if(vo==null||vd==null) return;
        var ko=rk(ro,ctxO,vo), kd=rk(rd,ctxD,vd), a=avg(ro,ctxO);
        var edge='';
        if(ro.hi!=null&&ko&&kd){ var e=ko.p-kd.p, w=Math.min(50,Math.abs(e)/2);
          edge='<span class="dsx-edge" title="'+(e>=0?esc(nO):esc(nD))+' edge: '+Math.abs(e)+' percentile points"><i style="'+(e>=0?'left:50%;background:'+colO:'right:50%;background:'+colD)+';width:'+w+'%"></i></span>'; }
        var n=ro.n?ro.n(ctxO,idO):null;
        body+='<tr><td class="dsx-l"'+tip(ro.tip)+'>'+(pr[2]||ro.l)+(n!=null?'<small>'+n+' poss</small>':'')+'</td>'+
          '<td class="'+(ko&&ro.hi!=null?cb(ko.p):'')+'">'+fmt(vo,ro.f)+'</td><td class="dsx-r">'+(ko?ord(ko.r):'')+'</td>'+
          '<td class="'+(kd&&rd.hi!=null?cb(kd.p):'')+'">'+fmt(vd,rd.f)+'</td><td class="dsx-r">'+(kd?ord(kd.r):'')+'</td>'+
          '<td class="dsx-a">'+fmt(a,ro.f)+'</td><td class="c">'+edge+'</td></tr>';
      });
      if(body) h+='<tr class="dsx-g"><td colspan="7">'+g[0]+'</td></tr>'+body; });
    return {html:h+'</tbody></table></div>', logos:[img(lo),img(ld)]};
  }
  function versus(host, o){ css(); if(!host) return Promise.resolve();
    var ps=+o.playSeason||(+o.season>=2027?2026:+o.season), gs=+o.season;
    return Promise.all([dna(),ids(),play(ps),genome(gs)]).then(function(r){
      var R={IDM:r[1]}; R.dnaCtx=new Ctx(o.season,r[0],null,null,r[1]); R.playCtx=r[2]?new Ctx(ps,r[0],r[2],null,r[1]):null; R.sgCtx=r[3]?new Ctx(gs,r[0],null,r[3],r[1]):null;
      var colA=o.colorA||'var(--dsx-ink)', colB=o.colorB||'var(--text3)';
      var A=vsSheet(R,o.a,o.b,o.nameA,o.nameB,colA,colB), B=vsSheet(R,o.b,o.a,o.nameB,o.nameA,colB,colA);
      host.innerHTML='<div class="dsx"><div class="dsx-cols"><div><div class="dsx-h"><span style="color:var(--text2);font-weight:800;letter-spacing:.08em;text-transform:uppercase">'+A.logos[0]+'When '+esc(o.nameA)+' has the ball</span><span>'+esc(o.nameA)+' offense vs '+esc(o.nameB)+' defense</span></div>'+A.html+'</div>'+
        '<div><div class="dsx-h"><span style="color:var(--text2);font-weight:800;letter-spacing:.08em;text-transform:uppercase">'+B.logos[0]+'When '+esc(o.nameB)+' has the ball</span><span>'+esc(o.nameB)+' offense vs '+esc(o.nameA)+' defense</span></div>'+B.html+'</div></div>'+
        '<div class="dsx-leg"><span>Ratings and four factors: '+slbl(o.season)+'. Shot zones and possessions: '+slbl(ps)+' play-by-play.</span><span>Edge bar points toward the side with the better D-I percentile; shading is good-for-that-side.</span></div></div>';
    }); }

  window.TDC_DNASHEET={team:team, versus:versus, data:data, slbl:slbl};
})();
