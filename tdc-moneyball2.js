/* Moneyball (Oct 2026 rebuild) — one idea: WINS PER DOLLAR.
   Every player: COST = open-market NIL value (tdc-nil.js neutralValueOf, the figure on his player page)
                 WINS = projected 2026-27 wins added from his OVERALL × projected minutes: 0.004774·(OVR−65)·MPG
                        (fit to projected Wins Added on power-conference rotation players, r=.94). Using the
                        overall keeps wins level-adjusted and consistent with every grade on the site.
   GOING RATE  = total cost ÷ total wins across rotation players (one league-wide number).
   VALUE       = wins × going rate − cost.  Bargain ≥ +25% of cost · Overpriced ≤ −25%.
   Tabs: Players (bargain board + the one chart) · Programs (roster cost, wins, value + cost to build a
   team) · GM Mode (tdc-gm.js, given the same wins + going rate). */
(function(){
  var FRESH_K=0.004774, FRESH_O=65, MPG_CAP=38, ROT_MIN=10;
  var MB=null, RATE=null, CURVE=null, TCURVE=null, PL={sort:'value',dir:-1,q:'',pos:'all',conf:'all',cls:'all',verd:'all',price:'all',limit:50},
      PG={sort:'value',dir:-1,q:'',conf:'all',limit:50,sel:null};
  function $(id){ return document.getElementById(id); }
  function esc(s){ return (''+(s==null?'':s)).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function fM(m){ if(m==null||!isFinite(m)) return '—'; var a=Math.abs(m), s=a>=1000?'$'+(a/1000).toFixed(2)+'B':a>=1?'$'+a.toFixed(2)+'M':'$'+Math.round(a*1000)+'K'; return (m<0?'−':'')+s; }
  function fSign(m){ return m==null||!isFinite(m)?'—':(m>=0?'+':'')+fM(m); }
  function sum(a){ return a.reduce(function(s,x){ return s+x; },0); }
  function med(a){ a=a.slice().sort(function(x,y){return x-y;}); return a.length?a[Math.floor(a.length/2)]:null; }
  function band(cells){ return '<div class="mb-band" style="--n:'+cells.length+'">'+cells.map(function(c){ return '<div class="cell"><div class="v">'+c.v+'</div><div class="l">'+c.l+'</div>'+(c.s?'<div class="s">'+c.s+'</div>':'')+'</div>'; }).join('')+'</div>'; }
  function secH(t,n){ return '<div class="sec-h">'+t+(n?' <span class="note">'+n+'</span>':'')+'</div>'; }
  function projWins(r){ return Math.max(4,Math.min(35,15.91+0.548*r)); }
  function heatV(r){ return r>=0.5?'c4':r>=0.2?'c3':r>-0.2?'c2':r>-0.5?'c1':'c0'; }
  function verdict(p){ var r=p.value/Math.max(p.cost,0.25); if(Math.abs(p.value)<0.15) return 'f'; return r>=0.25?'b':r<=-0.25?'o':'f'; }
  var POWER=['ACC','B10','BIG-12','SEC','Big-East','Big Ten','Big 12','Big East'];
  function confOk(c,want){ return want==='all'||(want==='__power'?POWER.indexOf(c)>=0:c===want); }
  var VLBL={b:'Bargain',f:'Fair',o:'Overpriced'};

  // ── data ────────────────────────────────────────────────────────────────
  function build(){
    if(MB) return Promise.resolve(MB);
    var N=window.TDC_NIL, R=window.TDC_RATINGS;
    var waits=['pedigreeReady','defenseReady','adjustReady','injuryReady','programsReady'].map(function(k){ return (N&&N[k])?N[k].catch(function(){}):null; });
    return Promise.all([
      fetch('nil-data.json?v=gradesync15').then(function(r){return r.json();}),
      fetch('scripts/data/stat_overall_projected.json?v=84').then(function(r){return r.json();}),
      fetch('scripts/data/fresh_fit.json?v=25').then(function(r){return r.ok?r.json():{};}).catch(function(){return {};}),
      R.get()].concat(waits)).then(function(a){
      var nil=a[0], SOP=(a[1]&&a[1].players)||{}, FF=a[2]||{}, D=a[3]||{teams:[]};
      var rat={}; (D.teams||[]).forEach(function(t){ rat[t.team]=t; });
      var sosByFull={}; Object.keys(SOP).forEach(function(k){ var r=SOP[k]; if(r.team&&r.sos!=null&&sosByFull[r.team]==null) sosByFull[r.team]=r.sos; });
      var players=[];
      Object.keys(nil.teams||{}).forEach(function(short){
        var T=nil.teams[short], info=rat[short]||{}, full=info.full||short, tsos=sosByFull[full]!=null?sosByFull[full]:0.8;
        (T.players||[]).forEach(function(p){
          if(p.walkon) return;
          var pr=p.espn_id!=null?SOP[String(p.espn_id)]:null, wins, mpg, ovr=(pr&&pr.ovr!=null)?pr.ovr:p.grade;
          // WINS = overall × projected minutes (0.004774·(OVR−65)·MPG). The overall already carries the
          // level-of-competition and usage adjustments, so a low-major's box-score Wins Added can't
          // out-rank an All-American here (raw proj_wa × sos still put 74-OVR mid-majors in the top 10).
          var ff=(FF[short]||{})[p.name];
          mpg=Math.min(MPG_CAP, (pr&&+pr.mpg)||(ff&&ff.mpg)||+p.mpg||0);
          wins=Math.max(-0.3, FRESH_K*((+ovr||FRESH_O)-FRESH_O)*mpg);
          var cost=(N&&N.neutralValueOf)?N.neutralValueOf(p):(+p.value||0);
          if(!isFinite(cost)) cost=0;
          players.push({name:p.name, team:short, full:full, conf:info.conf||p.conf||'', espn:p.espn_id, pos:(N&&N.POS5)?N.POS5(p.pos||''):(p.pos||''),
            cls:(p.cls||'').replace(/\./g,''), ovr:ovr!=null?Math.round(+ovr):null, mpg:mpg, wins:wins, cost:cost});
        });
      });
      var rot=players.filter(function(p){ return p.mpg>=ROT_MIN && p.wins>0.1 && p.cost>0; });
      RATE=sum(rot.map(function(p){return p.cost;}))/Math.max(1e-6,sum(rot.map(function(p){return p.wins;})));
      // THE MARKET PRICE FOR HIS QUALITY: the median cost of the 30 rotation players closest to him in
      // overall and minutes. (A curve on wins alone called every star overpriced — the market pays a steep
      // premium for elite talent — and a smooth OVR fit overshot the real market at the top; neighbours
      // keep a star judged against other stars, a role player against role players, inside real prices.)
      var POOL=rot.filter(function(p){ return p.ovr!=null&&p.cost>0.05; }).sort(function(a,b){ return a.ovr-b.ovr; });
      CURVE=function(ovr,mpg,self){ if(ovr==null||!(mpg>0)||!POOL.length) return 0;
        var lm=Math.log(Math.max(1,mpg)), near=[];
        for(var w=4; w<=40 && near.length<30; w*=2){ near=POOL.filter(function(q){ return q!==self&&Math.abs(q.ovr-ovr)<=w; }); }
        near=near.map(function(q){ var a=(q.ovr-ovr)/2, b=(Math.log(Math.max(1,q.mpg))-lm)/0.25; return [a*a+b*b,q.cost]; }).sort(function(x,y){ return x[0]-y[0]; }).slice(0,30).map(function(x){ return x[1]; }).sort(function(x,y){ return x-y; });
        var n=near.length; return n? (n%2? near[(n-1)/2] : (near[n/2-1]+near[n/2])/2) : 0; };
      players.forEach(function(p){ p.expected=CURVE(p.ovr,p.mpg,p); p.value=p.expected-p.cost; p.cpw=p.wins>0.05?p.cost/p.wins:null; p.v=verdict(p); });
      var teams={};
      players.forEach(function(p){ (teams[p.team]=teams[p.team]||{team:p.team,full:p.full,conf:p.conf,players:[]}).players.push(p); });
      Object.keys(teams).forEach(function(k){ var t=teams[k], info=rat[k]||{};
        t.cost=sum(t.players.map(function(p){return p.cost;})); t.wins=sum(t.players.map(function(p){return Math.max(0,p.wins);}));
        t.rank=info.rank||null; t.rating=info.rating; t.rec=info.rating!=null?Math.round(projWins(info.rating)):null;
        t.cpw=t.rec?t.cost/t.rec:null;
        t.best=t.players.slice().sort(function(a,b){return b.value-a.value;})[0]; t.n=t.players.length; });
      // PROGRAM CURVE: what a roster projected this good usually costs — ln(cost) = a + b·rating over every
      // priced roster. Value = expected − actual (a cheap roster that projects well is the bargain).
      (function(){ var T=Object.keys(teams).map(function(k){return teams[k];}).filter(function(t){ return t.n>=5&&t.cost>0.3&&t.rating!=null; });
        var n=T.length, xs=T.map(function(t){return t.rating;}), ys=T.map(function(t){return Math.log(t.cost);});
        var mx=sum(xs)/n, my=sum(ys)/n, sxy=0, sxx=0; for(var i=0;i<n;i++){ sxy+=(xs[i]-mx)*(ys[i]-my); sxx+=(xs[i]-mx)*(xs[i]-mx); }
        var b=sxy/sxx, a=my-b*mx; TCURVE=function(r){ return Math.exp(a+b*r); };
        Object.keys(teams).forEach(function(k){ var t=teams[k]; if(t.rating!=null){ t.expected=TCURVE(t.rating); t.value=t.expected-t.cost; } else { t.expected=null; t.value=null; } }); })();
      MB={players:players, rot:rot, teams:teams, D:D};
      return MB;
    });
  }

  // ── PLAYERS ─────────────────────────────────────────────────────────────
  function plFiltered(){ var s=PL, q=s.q.trim().toLowerCase();
    return MB.players.filter(function(p){ return p.mpg>=ROT_MIN &&
      (s.pos==='all'||p.pos===s.pos) && confOk(p.conf,s.conf) && (s.cls==='all'||(p.cls||'').toLowerCase().indexOf(s.cls)>=0) &&
      (s.verd==='all'||p.v===s.verd) && (s.price==='all'||(s.price==='1'?p.cost<1:s.price==='3'?(p.cost>=1&&p.cost<3):p.cost>=3)) &&
      (!q||p.name.toLowerCase().indexOf(q)>=0||p.team.toLowerCase().indexOf(q)>=0); }); }
  function renderPlayers(){
    var rot=MB.players.filter(function(p){ return p.mpg>=ROT_MIN; });
    var nb=rot.filter(function(p){return p.v==='b';}).length, no=rot.filter(function(p){return p.v==='o';}).length;
    var best=rot.slice().sort(function(a,b){return b.value-a.value;})[0];
    var confs=Array.from(new Set(rot.map(function(p){return p.conf;}).filter(Boolean))).sort();
    $('playersBody').innerHTML=
      '<div class="explain"><div><b>Cost</b>What he would command on the open NIL market. The same number as his player page.</div><div><b>Wins</b>Wins he is projected to add in 2026-27: his overall × his projected minutes.</div><div><b>Value</b>What the 30 players closest to him in overall and minutes usually cost, minus what he costs. Positive = you get him for less than the market charges for his quality.</div></div>'+
      band([{v:fM(CURVE(80,25))+' · '+fM(CURVE(90,32)),l:'Market price',s:'an 80 OVR, 25-min player · a 90 OVR star'},{v:rot.length.toLocaleString(),l:'Rotation players',s:'10+ projected minutes'},
            {v:nb,l:'Bargains',s:'value ≥ 25% of cost and $150K'},{v:no,l:'Overpriced',s:'value ≤ −25% of cost and $150K'}])+
      secH('What he costs vs what players like him cost','each dot is a player in your filter · hover for details')+
      '<div class="chart" id="plChart"></div>'+
      secH('Bargain board','sort any column')+
      '<div class="ctrls"><input id="plQ" placeholder="Search a player or school…" value="'+esc(PL.q)+'" aria-label="Search players">'+
        '<select id="plPos" aria-label="Position"><option value="all">All positions</option>'+['PG','SG','SF','PF','C'].map(function(x){ return '<option'+(PL.pos===x?' selected':'')+'>'+x+'</option>'; }).join('')+'</select>'+
        '<select id="plConf" aria-label="Conference"><option value="all">All conferences</option><option value="__power"'+(PL.conf==='__power'?' selected':'')+'>Power conferences</option>'+confs.map(function(c){ return '<option'+(PL.conf===c?' selected':'')+'>'+esc(c)+'</option>'; }).join('')+'</select>'+
        '<select id="plCls" aria-label="Class"><option value="all">All classes</option><option value="fr"'+(PL.cls==='fr'?' selected':'')+'>Freshmen</option><option value="so"'+(PL.cls==='so'?' selected':'')+'>Sophomores</option><option value="jr"'+(PL.cls==='jr'?' selected':'')+'>Juniors</option><option value="sr"'+(PL.cls==='sr'?' selected':'')+'>Seniors</option><option value="gr"'+(PL.cls==='gr'?' selected':'')+'>Grad</option></select>'+
        '<select id="plPrice" aria-label="Price"><option value="all">Any price</option><option value="1"'+(PL.price==='1'?' selected':'')+'>Under $1M</option><option value="3"'+(PL.price==='3'?' selected':'')+'>$1M–$3M</option><option value="hi"'+(PL.price==='hi'?' selected':'')+'>$3M+</option></select>'+
        '<div class="seg" id="plVerd" role="group" aria-label="Verdict">'+[['all','All'],['b','Bargains'],['f','Fair'],['o','Overpriced']].map(function(x){ return '<button type="button" data-v="'+x[0]+'" class="'+(PL.verd===x[0]?'on':'')+'">'+x[1]+'</button>'; }).join('')+'</div></div>'+
      '<div class="sheet-wrap" style="max-height:none;"><table class="sheet dense"><thead id="plHead"></thead><tbody id="plRows"></tbody></table></div><div id="plMore"></div>'+
      '<div class="disclaimer">'+(best?('Best bargain in the country: <b>'+esc(best.name)+'</b> ('+esc(best.team)+'), '+fSign(best.value)+' of value. '):'')+'Cost is a market estimate, not a contract. "Players like him" = the median cost of the 30 rotation players nationwide closest to him in overall and projected minutes.</div>';
    function on(id,ev,f){ var e=$(id); if(e) e.addEventListener(ev,f); }
    var deb; on('plQ','input',function(e){ clearTimeout(deb); var v=e.target.value; deb=setTimeout(function(){ PL.q=v; PL.limit=50; paintPl(); },200); });
    on('plPos','change',function(e){ PL.pos=e.target.value; PL.limit=50; paintPl(); });
    on('plConf','change',function(e){ PL.conf=e.target.value; PL.limit=50; paintPl(); });
    on('plCls','change',function(e){ PL.cls=e.target.value; PL.limit=50; paintPl(); });
    on('plPrice','change',function(e){ PL.price=e.target.value; PL.limit=50; paintPl(); });
    on('plVerd','click',function(e){ var b=e.target.closest('button'); if(!b) return; PL.verd=b.dataset.v; PL.sort='value'; PL.dir=(PL.verd==='o')?1:-1; $('plVerd').querySelectorAll('button').forEach(function(x){ x.classList.toggle('on',x===b); }); PL.limit=50; paintPl(); });
    paintPl();
  }
  var PCOLS=[['#','rk',null],['Player','l','name'],['School','l','team'],['Pos','l',null],['Yr','l',null],['OVR','','ovr'],['MPG','','mpg'],['Wins','','wins'],['Cost','','cost'],['Players like him','','expected'],['Value','','value'],['','l',null]];
  function paintPl(){
    var list=plFiltered(), s=PL;
    list.sort(function(a,b){ var k=s.sort, x=a[k], y=b[k]; if(k==='name'||k==='team') return (''+x).localeCompare(''+y)*-s.dir; return ((x==null?-1e9:x)-(y==null?-1e9:y))*s.dir; });
    $('plHead').innerHTML='<tr>'+PCOLS.map(function(c){ var k=c[2], on=k===s.sort; return '<th class="'+c[1]+(k?' sort':'')+'"'+(k?' data-k="'+k+'"':'')+'>'+c[0]+(on?'<span class="ar">'+(s.dir<0?'▼':'▲')+'</span>':'')+'</th>'; }).join('')+'</tr>';
    var shown=list.slice(0,s.limit);
    $('plRows').innerHTML=shown.map(function(p,i){ var r=p.value/Math.max(p.cost,0.25);
      return '<tr><td class="rk">'+(i+1)+'</td><td class="l nm"><a href="player.html?espn='+encodeURIComponent(p.espn||'')+'&team='+encodeURIComponent(p.team)+'">'+esc(p.name)+'</a></td><td class="l dim">'+esc(p.team)+'</td><td class="l dim">'+p.pos+'</td><td class="l dim">'+esc(p.cls)+'</td>'+
        '<td>'+(p.ovr!=null?p.ovr:'—')+'</td><td class="dim">'+Math.round(p.mpg)+'</td><td>'+p.wins.toFixed(1)+'</td><td>'+fM(p.cost)+'</td><td class="dim">'+fM(p.expected)+'</td>'+
        '<td class="strong '+heatV(r)+'">'+fSign(p.value)+'</td><td class="l"><span class="vd '+p.v+'">'+VLBL[p.v]+'</span></td></tr>'; }).join('')||'<tr><td colspan="12" class="dim" style="padding:22px;text-align:center">No players match.</td></tr>';
    $('plMore').innerHTML=list.length>shown.length?'<button type="button" class="more" id="plMoreB">Show 50 more ('+(list.length-shown.length)+' left)</button>':'';
    var mb=$('plMoreB'); if(mb) mb.addEventListener('click',function(){ PL.limit+=50; paintPl(); });
    $('plHead').querySelectorAll('th[data-k]').forEach(function(th){ th.addEventListener('click',function(){ var k=th.dataset.k; if(PL.sort===k) PL.dir*=-1; else { PL.sort=k; PL.dir=(k==='name'||k==='team')?1:-1; } paintPl(); }); });
    paintChart(list);
  }
  // THE ONE CHART: cost (→) vs wins (↑). The dashed line is the going rate — a player ON the line costs
  // exactly what his wins are worth; ABOVE it, more wins than the price buys (a bargain).
  function paintChart(list){
    var host=$('plChart'); if(!host) return;
    var pts=list.filter(function(p){ return p.cost>0&&p.expected>0; }).slice().sort(function(a,b){ return b.cost-a.cost; }).slice(0,900);
    if(!pts.length){ host.innerHTML='<div class="loading" style="padding:30px">No players in this filter.</div>'; return; }
    var W=760,H=360,mL=54,mR=34,mT=14,mB=40,pw=W-mL-mR,ph=H-mT-mB;
    var mx=Math.max(1,Math.max.apply(null,pts.map(function(p){return Math.max(p.cost,p.expected);}))*1.05);
    var X=function(v){ return mL+v/mx*pw; }, Y=function(v){ return mT+ph-v/mx*ph; };
    var col={b:'var(--green)',f:'var(--text3)',o:'var(--red)'};
    var t=[0,.25,.5,.75,1].map(function(f){ return mx*f; });
    var svg='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="What each player costs against what players like him usually cost, '+pts.length+' players">'+
      t.map(function(v){ return '<line x1="'+mL+'" x2="'+(W-mR)+'" y1="'+Y(v).toFixed(1)+'" y2="'+Y(v).toFixed(1)+'" stroke="var(--border)"/><text x="'+(mL-6)+'" y="'+(Y(v)+4).toFixed(1)+'" font-size="11" text-anchor="end">'+fM(v)+'</text><text x="'+X(v).toFixed(1)+'" y="'+(H-20)+'" font-size="11" text-anchor="middle">'+fM(v)+'</text>'; }).join('')+
      '<line x1="'+X(0)+'" y1="'+Y(0)+'" x2="'+X(mx).toFixed(1)+'" y2="'+Y(mx).toFixed(1)+'" stroke="var(--text3)" stroke-width="1.6" stroke-dasharray="6 5"/>'+
      '<text x="'+(W-mR)+'" y="'+(H-3)+'" font-size="11" text-anchor="end">What players like him usually cost →</text><text x="'+(mL+4)+'" y="'+(mT+10)+'" font-size="11">What he costs ↑</text>'+
      pts.map(function(p,i){ return '<circle cx="'+X(p.expected).toFixed(1)+'" cy="'+Y(p.cost).toFixed(1)+'" r="4.2" fill="'+col[p.v]+'" fill-opacity=".72" data-i="'+i+'"/>'; }).join('')+'</svg>';
    host.innerHTML='<div class="key"><span><i style="background:var(--green)"></i>Bargain: below the line, costs less than players like him</span><span><i style="background:var(--text3)"></i>Fair</span><span><i style="background:var(--red)"></i>Overpriced: above the line</span><span><i class="ln"></i>Fair price</span></div>'+svg;
    var tip=$('tip');
    host.onmousemove=function(e){ var c=e.target.closest&&e.target.closest('circle'); if(!c){ tip.style.display='none'; return; } var p=pts[+c.dataset.i];
      tip.innerHTML='<div class="tn">'+esc(p.name)+'</div><div class="tm">'+esc(p.team)+' · '+p.pos+' · '+(p.ovr!=null?p.ovr+' OVR':'')+' · '+Math.round(p.mpg)+' min</div><div class="tr"><span>He costs</span><b>'+fM(p.cost)+'</b></div><div class="tr"><span>Players like him</span><b>'+fM(p.expected)+'</b></div><div class="tr"><span>Value</span><b style="color:'+col[p.v]+'">'+fSign(p.value)+'</b></div>';
      tip.style.display='block'; tip.style.left=Math.min(innerWidth-240,e.clientX+14)+'px'; tip.style.top=Math.max(8,e.clientY-12)+'px'; };
    host.onmouseleave=function(){ tip.style.display='none'; };
    host.onclick=function(e){ var c=e.target.closest&&e.target.closest('circle'); if(!c) return; var p=pts[+c.dataset.i]; location.href='player.html?espn='+encodeURIComponent(p.espn||'')+'&team='+encodeURIComponent(p.team); };
  }

  // ── PROGRAMS ────────────────────────────────────────────────────────────
  function renderPrograms(){
    var T=Object.keys(MB.teams).map(function(k){return MB.teams[k];}).filter(function(t){ return t.n>=5&&t.cost>0; });
    var ranked=T.filter(function(t){return t.rank;});
    var BANDS=[[1,10,'Top 10'],[11,25,'11–25'],[26,50,'26–50'],[51,75,'51–75'],[76,100,'76–100'],[101,200,'101–200'],[201,999,'201+']];
    var rows=BANDS.map(function(b){ var g=ranked.filter(function(t){return t.rank>=b[0]&&t.rank<=b[1];}); if(!g.length) return '';
      var c=g.map(function(t){return t.cost;}).sort(function(x,y){return x-y;});
      var cheap=g.slice().sort(function(a,b){return a.cost-b.cost;})[0], dear=g.slice().sort(function(a,b){return b.cost-a.cost;})[0];
      return '<tr><td class="l nm">'+b[2]+'</td><td class="dim">'+g.length+'</td><td class="strong">'+fM(med(c))+'</td><td>'+fM(c[Math.floor(c.length*0.1)])+'+</td><td class="l">'+esc(cheap.full)+' <span class="dim">'+fM(cheap.cost)+'</span></td><td class="l">'+esc(dear.full)+' <span class="dim">'+fM(dear.cost)+'</span></td></tr>'; }).join('');
    var dear=T.slice().sort(function(a,b){return b.cost-a.cost;})[0], bestV=T.filter(function(t){return t.value!=null;}).sort(function(a,b){return b.value-a.value;})[0];
    var confs=Array.from(new Set(T.map(function(t){return t.conf;}).filter(Boolean))).sort();
    $('programsBody').innerHTML=
      '<div class="explain"><div><b>Roster cost</b>Every player\'s open-market NIL value, added up. Not what the school actually pays.</div><div><b>Usually costs</b>What a roster projected this good typically costs, from every program in the country.</div><div><b>Value</b>Usually costs minus roster cost. Positive = this program gets its projected strength for less than the market.</div></div>'+
      band([{v:fM(TCURVE(20)),l:'A top-10 roster',s:'usually costs (rating +20)'},{v:esc(dear.full),l:'Most expensive roster',s:fM(dear.cost)},{v:esc(bestV.full),l:'Best value',s:fSign(bestV.value)+' under the market'},
            {v:fM(med(ranked.filter(function(t){return t.rank<=25;}).map(function(t){return t.cost;}))),l:'Typical top-25 roster',s:'median cost'}])+
      secH('What it costs to build a team','by projected 2026-27 ranking')+
      '<div class="sheet-wrap" style="max-height:none;"><table class="sheet dense"><thead><tr><th class="l">Projected rank</th><th>Programs</th><th>Median cost</th><th title="90% of rosters in the band cost at least this">Floor (90%)</th><th class="l">Cheapest</th><th class="l">Most expensive</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
      secH('Every program','sort any column · click a program for its best and worst value')+
      '<div class="ctrls"><input id="pgQ" placeholder="Search a program…" value="'+esc(PG.q)+'" aria-label="Search programs"><select id="pgConf" aria-label="Conference"><option value="all">All conferences</option><option value="__power"'+(PG.conf==='__power'?' selected':'')+'>Power conferences</option>'+confs.map(function(c){ return '<option'+(PG.conf===c?' selected':'')+'>'+esc(c)+'</option>'; }).join('')+'</select></div>'+
      '<div class="sheet-wrap" style="max-height:none;"><table class="sheet dense"><thead id="pgHead"></thead><tbody id="pgRows"></tbody></table></div><div id="pgMore"></div><div id="pgDetail"></div>'+
      '<div class="disclaimer">Roster cost and value are model estimates from open-market NIL values, not cap sheets. "Usually costs" is fit across every priced roster against its projected Power Rating. Cost per win = roster cost ÷ projected wins.</div>';
    var deb; $('pgQ').addEventListener('input',function(e){ clearTimeout(deb); var v=e.target.value; deb=setTimeout(function(){ PG.q=v; PG.limit=50; paintPg(T); },200); });
    $('pgConf').addEventListener('change',function(e){ PG.conf=e.target.value; PG.limit=50; paintPg(T); });
    paintPg(T);
  }
  var GCOLS=[['#','rk',null],['Program','l','full'],['Conf','l','conf'],['Proj. rank','','rank'],['Proj. record','','rec'],['Roster cost','','cost'],['Usually costs','','expected'],['Value','','value'],['Cost / win','','cpw'],['Best bargain','l',null]];
  function paintPg(T){
    var s=PG, q=s.q.trim().toLowerCase();
    var list=T.filter(function(t){ return confOk(t.conf,s.conf)&&(!q||t.full.toLowerCase().indexOf(q)>=0||t.team.toLowerCase().indexOf(q)>=0); });
    list.sort(function(a,b){ var k=s.sort, x=a[k], y=b[k]; if(k==='full'||k==='conf') return (''+x).localeCompare(''+y)*-s.dir; return ((x==null?(s.dir<0?-1e9:1e9):x)-(y==null?(s.dir<0?-1e9:1e9):y))*s.dir; });
    $('pgHead').innerHTML='<tr>'+GCOLS.map(function(c){ var k=c[2], on=k===s.sort; return '<th class="'+c[1]+(k?' sort':'')+'"'+(k?' data-k="'+k+'"':'')+'>'+c[0]+(on?'<span class="ar">'+(s.dir<0?'▼':'▲')+'</span>':'')+'</th>'; }).join('')+'</tr>';
    var shown=list.slice(0,s.limit);
    $('pgRows').innerHTML=shown.map(function(t,i){ var r=(t.value||0)/Math.max(t.cost,1);
      return '<tr class="clik'+(PG.sel===t.team?' sel':'')+'" data-t="'+esc(t.team)+'"><td class="rk">'+(i+1)+'</td><td class="l nm">'+esc(t.full)+'</td><td class="l dim">'+esc(t.conf)+'</td><td class="dim">'+(t.rank?'#'+t.rank:'—')+'</td><td class="dim">'+(t.rec!=null?t.rec+'–'+Math.max(0,32-t.rec):'—')+'</td>'+
        '<td class="strong">'+fM(t.cost)+'</td><td class="dim">'+(t.expected!=null?fM(t.expected):'—')+'</td><td class="'+(t.value!=null?heatV(r):'')+'">'+(t.value!=null?fSign(t.value):'—')+'</td><td class="dim">'+(t.cpw!=null?fM(t.cpw):'—')+'</td><td class="l">'+(t.best?esc(t.best.name)+' <span class="dim">'+fSign(t.best.value)+'</span>':'—')+'</td></tr>'; }).join('');
    $('pgMore').innerHTML=list.length>shown.length?'<button type="button" class="more" id="pgMoreB">Show 50 more ('+(list.length-shown.length)+' left)</button>':'';
    var mb=$('pgMoreB'); if(mb) mb.addEventListener('click',function(){ PG.limit+=50; paintPg(T); });
    $('pgHead').querySelectorAll('th[data-k]').forEach(function(th){ th.addEventListener('click',function(){ var k=th.dataset.k; if(PG.sort===k) PG.dir*=-1; else { PG.sort=k; PG.dir=(k==='full'||k==='conf'||k==='rank'||k==='cpw')?1:-1; } paintPg(T); }); });
    $('pgRows').querySelectorAll('tr.clik').forEach(function(tr){ tr.addEventListener('click',function(){ PG.sel=(PG.sel===tr.dataset.t)?null:tr.dataset.t; paintPg(T); }); });
    paintDetail();
  }
  function paintDetail(){
    var host=$('pgDetail'); if(!host) return; var t=PG.sel&&MB.teams[PG.sel]; if(!t){ host.innerHTML=''; return; }
    var ps=t.players.filter(function(p){return p.mpg>=ROT_MIN;});
    var best=ps.slice().sort(function(a,b){return b.value-a.value;}).slice(0,5), worst=ps.slice().sort(function(a,b){return a.value-b.value;}).slice(0,5);
    var sh=function(rows){ return '<div class="sheet-wrap" style="max-height:none;"><table class="sheet dense"><thead><tr><th class="l">Player</th><th>Wins</th><th>Cost</th><th>Value</th></tr></thead><tbody>'+rows.map(function(p){ return '<tr><td class="l nm"><a href="player.html?espn='+encodeURIComponent(p.espn||'')+'&team='+encodeURIComponent(p.team)+'">'+esc(p.name)+'</a></td><td>'+p.wins.toFixed(1)+'</td><td>'+fM(p.cost)+'</td><td class="'+heatV(p.value/Math.max(p.cost,0.25))+'">'+fSign(p.value)+'</td></tr>'; }).join('')+'</tbody></table></div>'; };
    host.innerHTML='<div class="detail"><h3>'+esc(t.full)+'</h3><div class="dm">'+esc(t.conf||'')+(t.rank?' · #'+t.rank+' projected':'')+' · roster cost '+fM(t.cost)+(t.expected!=null?(' · rosters this good usually cost '+fM(t.expected)+' ('+fSign(t.value)+')'):'')+' · <a href="moneyball.html?tab=gm&team='+encodeURIComponent(t.team)+'">Open in GM Mode →</a></div>'+
      '<div class="cols"><div><div class="ch" style="color:var(--green)">Best value</div>'+sh(best)+'</div><div><div class="ch" style="color:var(--red)">Least value</div>'+sh(worst)+'</div></div></div>';
    host.scrollIntoView({behavior:'smooth',block:'nearest'});
  }

  // ── tabs ────────────────────────────────────────────────────────────────
  var booted={}, INIT=new URLSearchParams(location.search);
  function show(name){
    document.querySelectorAll('.mb-tab').forEach(function(b){ var on=b.dataset.tab===name; b.classList.toggle('on',on); b.setAttribute('aria-selected',on?'true':'false'); });
    document.querySelectorAll('.mb-panel').forEach(function(p){ p.classList.toggle('on',p.id==='tab-'+name); });
    if(!booted[name]){ booted[name]=true;
      if(name==='gm'){ build().then(function(){ var w={}; MB.players.forEach(function(p){ w[p.team+'|'+(p.name||'').toLowerCase().trim()]=p.wins; });
          var cp=Object.keys(MB.teams).map(function(k){return MB.teams[k].cpw;}).filter(function(x){return x!=null&&isFinite(x);});
          window.TDC_GM.boot($('gmBody'),{projWins:projWins, rate:med(cp), teamCurve:TCURVE, winsOf:function(key){ return w[key]; }}); }); }
      else build().then(function(){ if(name==='players') renderPlayers(); else renderPrograms(); }).catch(function(e){ $(name+'Body').innerHTML='<div class="loading">Could not load ('+esc(e&&e.message||e)+').</div>'; });
    }
    try{ var sp=new URLSearchParams(location.search); sp.set('tab',name); if(name!=='gm'){ sp.delete('team'); sp.delete('gm'); } history.replaceState(null,'',location.pathname+'?'+sp.toString()); }catch(e){}
  }
  window.showTab=show;   // page tour hook
  document.getElementById('mbTabs').addEventListener('click',function(e){ var b=e.target.closest('.mb-tab'); if(b) show(b.dataset.tab); });
  if(INIT.get('q')) PL.q=INIT.get('q');                                  // player page → his row on the board
  if(INIT.get('team') && /^(ledger|values|programs)$/.test(INIT.get('tab')||'')) PG.sel=INIT.get('team');   // team page → its program
  var t=INIT.get('tab'), MAP={players:'players',market:'players',programs:'programs',values:'programs',ledger:'programs',gm:'gm',office:'gm'};
  show(MAP[t]||(INIT.get('team')?'gm':'players'));
})();
