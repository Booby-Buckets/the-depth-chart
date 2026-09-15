/* tdc-shotprofile.js — shot profile by season, on the sheet kit.
   Data: build_shot_profiles.py rows (flat int lists, see ZONES order below), one per
   season, for a player (scripts/data/shot_profiles/<espn_id % 40>.json), a team or the
   whole league (scripts/data/shot_team_profiles.json). FG% cells are coloured vs the
   SAME season's D-I figure, shares are plain — a rising 3PA rate is a fact, not a grade.
   Needs tdc-sheets.css on the page.

     TDC_SHOTPROFILE.sheet(seasons, league, opts)   -> html   (seasons = {year: row})
     TDC_SHOTPROFILE.read(seasons, league, who)     -> one-sentence trend read
     TDC_SHOTPROFILE.fromShots(rows)                -> a row built from live shot rows
     TDC_SHOTPROFILE.load(espnId) / loadTeams()     -> promises for the JSON files          */
(function(){
  var ZONES=['rim','paint','midl','midc','midr','c3l','c3r','w3l','t3','w3r'];
  var THREE={c3l:1,c3r:1,w3l:1,t3:1,w3r:1}, CORNER={c3l:1,c3r:1}, MID={midl:1,midc:1,midr:1};
  function parse(row){
    if(!row) return null;
    var o={fga:row[0],fgm:row[1],ast:row[2],z:{}};
    ZONES.forEach(function(k,i){ o.z[k]={a:row[3+2*i],m:row[4+2*i]}; });
    return o;
  }
  function sum(o,keys){ var a=0,m=0; keys.forEach(function(k){ a+=o.z[k].a; m+=o.z[k].m; }); return {a:a,m:m}; }
  function derive(row){
    var o=parse(row); if(!o||!o.fga) return null;
    var three=sum(o,Object.keys(THREE)), corner=sum(o,Object.keys(CORNER)), mid=sum(o,Object.keys(MID)), rim=o.z.rim, paint=o.z.paint;
    var pct=function(x){ return x.a?x.m/x.a:null; };
    return {fga:o.fga, rimSh:rim.a/o.fga, paintSh:paint.a/o.fga, midSh:mid.a/o.fga, threeSh:three.a/o.fga,
      cornerSh:three.a?corner.a/three.a:null, astPct:o.fgm?o.ast/o.fgm:null,
      rimP:pct(rim), paintP:pct(paint), midP:pct(mid), threeP:pct(three),
      efg:(o.fgm+0.5*three.m)/o.fga};
  }
  function lbl(y){ y=+y; return (y-1)+'-'+String(y).slice(2); }
  function P(v,d){ return v==null?'—':(v*100).toFixed(d||0)+'%'; }
  // FG% cell coloured by the gap to the league that season; ±2 pts is noise
  function cell(v,l,min){
    if(v==null) return '<td class="dim">—</td>';
    if(l==null||min===false) return '<td>'+P(v)+'</td>';
    var d=(v-l)*100, c=d>=2?'var(--sc-hot,#f08a3c)':d<=-2?'var(--sc-cold,#5b8def)':'inherit';
    return '<td style="color:'+c+';font-weight:'+(Math.abs(d)>=2?800:500)+'" title="D-I '+P(l)+' that season">'+P(v)+'</td>';
  }
  function sheet(seasons, league, opts){
    opts=opts||{};
    var ys=Object.keys(seasons||{}).map(Number).sort(function(a,b){return a-b;});
    ys=ys.filter(function(y){ return derive(seasons[y]); });
    if(!ys.length) return '';
    var head='<tr><th class="l">Season</th>'+(opts.label?'<th class="l">'+opts.label+'</th>':'')+'<th>FGA</th><th>Rim</th><th>Paint</th><th>Mid</th><th>3PA</th><th>Corner 3s</th><th>Assisted</th><th>Rim FG%</th><th>Mid FG%</th><th>3P%</th><th>eFG%</th></tr>';
    var body=ys.map(function(y){
      var d=derive(seasons[y]), L=league&&league[y]?derive(league[y]):null, minFga=d.fga>=40;
      var extra=opts.label?'<td class="l dim">'+((opts.labels&&opts.labels[y])||'')+'</td>':'';
      return '<tr><td class="l nm">'+lbl(y)+(opts.live&&+y===opts.live?' <span class="dim" style="font-weight:500">live</span>':'')+'</td>'+extra+
        '<td class="dim">'+d.fga+'</td><td>'+P(d.rimSh)+'</td><td>'+P(d.paintSh)+'</td><td>'+P(d.midSh)+'</td><td class="strong">'+P(d.threeSh)+'</td><td>'+P(d.cornerSh)+'</td><td>'+P(d.astPct)+'</td>'+
        cell(d.rimP,L&&L.rimP,minFga)+cell(d.midP,L&&L.midP,minFga)+cell(d.threeP,L&&L.threeP,minFga)+cell(d.efg,L&&L.efg,minFga)+'</tr>';
    }).join('');
    var foot='';
    if(league&&opts.leagueRow!==false){
      var ly=ys[ys.length-1], L=league[ly]?derive(league[ly]):null;
      if(L) foot='<tr style="opacity:.75"><td class="l dim">D-I '+lbl(ly)+'</td>'+(opts.label?'<td></td>':'')+'<td class="dim">—</td><td class="dim">'+P(L.rimSh)+'</td><td class="dim">'+P(L.paintSh)+'</td><td class="dim">'+P(L.midSh)+'</td><td class="dim">'+P(L.threeSh)+'</td><td class="dim">'+P(L.cornerSh)+'</td><td class="dim">'+P(L.astPct)+'</td><td class="dim">'+P(L.rimP)+'</td><td class="dim">'+P(L.midP)+'</td><td class="dim">'+P(L.threeP)+'</td><td class="dim">'+P(L.efg)+'</td></tr>';
    }
    return '<div class="sheet-wrap"><table class="sheet" style="width:100%"><thead>'+head+'</thead><tbody>'+body+foot+'</tbody></table></div>'+
      '<div style="font-size:11px;color:var(--text3);margin-top:8px;line-height:1.5;">Rim / Paint / Mid / 3PA = share of attempts; Corner 3s = share of threes taken from the corners. FG% cells are coloured against the D-I figure for that same season (<span style="color:var(--sc-hot,#f08a3c);font-weight:800">above</span> / <span style="color:var(--sc-cold,#5b8def);font-weight:800">below</span> by 2+ pts). Located shots cover most games from 2019-20 on.</div>';
  }
  function read(seasons, league, who){
    var ys=Object.keys(seasons||{}).map(Number).sort(function(a,b){return a-b;}).filter(function(y){ var d=derive(seasons[y]); return d&&d.fga>=60; });
    if(ys.length<2) return '';
    var a=derive(seasons[ys[0]]), b=derive(seasons[ys[ys.length-1]]), bits=[];
    var d3=(b.threeSh-a.threeSh)*100, dr=(b.rimSh-a.rimSh)*100;
    if(Math.abs(d3)>=6) bits.push('3PA rate '+(d3>0?'rose':'fell')+' from '+P(a.threeSh)+' to '+P(b.threeSh));
    if(Math.abs(dr)>=6) bits.push('rim share '+(dr>0?'climbed':'dropped')+' from '+P(a.rimSh)+' to '+P(b.rimSh));
    if(a.rimP!=null&&b.rimP!=null&&Math.abs(b.rimP-a.rimP)>=0.05) bits.push('rim finishing went '+P(a.rimP)+' → '+P(b.rimP));
    if(a.threeP!=null&&b.threeP!=null&&Math.abs(b.threeP-a.threeP)>=0.04) bits.push('3P% went '+P(a.threeP)+' → '+P(b.threeP));
    if(a.astPct!=null&&b.astPct!=null&&Math.abs(b.astPct-a.astPct)>=0.10) bits.push((b.astPct<a.astPct?'more self-created — assisted share ':'more setup-dependent — assisted share ')+P(a.astPct)+' → '+P(b.astPct));
    if(!bits.length) return (who||'The profile')+' has held the same shape across '+ys.length+' seasons ('+lbl(ys[0])+' → '+lbl(ys[ys.length-1])+').';
    return (who||'Over '+ys.length+' seasons')+': '+bits.slice(0,3).join('; ')+' ('+lbl(ys[0])+' → '+lbl(ys[ys.length-1])+').';
  }
  // build a row from live shot rows ({x,y,sv,made,ast_id}) using the chart's own zone classifier
  function fromShots(rows){
    var z10=window.TDC_SHOTCHART&&TDC_SHOTCHART.zone10; if(!z10) return null;
    var row=[0,0,0]; ZONES.forEach(function(){ row.push(0,0); });
    (rows||[]).forEach(function(s){
      if(s.x==null||s.y==null) return;
      var k=z10(s), i=3+2*ZONES.indexOf(k); if(i<3) return;
      row[0]++; row[i]++;
      if(s.made){ row[1]++; row[i+1]++; if(s.ast_id||s.ast_name) row[2]++; }
    });
    return row[0]?row:null;
  }
  var _teams=null;
  function loadTeams(){
    if(!_teams) _teams=fetch('scripts/data/shot_team_profiles.json?v=1').then(function(r){ return r.ok?r.json():null; }).catch(function(){ return null; });
    return _teams;
  }
  function load(espn){
    espn=parseInt(espn,10); if(!espn) return Promise.resolve(null);
    return fetch('scripts/data/shot_profiles/'+(espn%40)+'.json?v=1').then(function(r){ return r.ok?r.json():null; })
      .then(function(j){ return j&&j[String(espn)]||null; }).catch(function(){ return null; });
  }
  window.TDC_SHOTPROFILE={sheet:sheet, read:read, derive:derive, fromShots:fromShots, load:load, loadTeams:loadTeams, ZONES:ZONES, lbl:lbl};
})();
