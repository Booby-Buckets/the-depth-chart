/* tdc-heat.js — percentile table renderer on the shared sheet kit (tdc-sheets.css).
   Each metric cell is shaded c0..c4 (red -> green) straight from its NATIONAL percentile
   (<20 c0, <40 c1, <60 c2, <80 c3, else c4), not by a within-table quintile, because a
   single player's rows should be graded against all of D-I, not against each other.
   The percentile (and rank, if given) is in the cell's hover title.
   TDCHeat.bucket(pct)      -> 'c0'..'c4' ('' for no percentile)
   TDCHeat.ord(p)           -> '84th'
   TDCHeat.table(cfg)       -> HTML string for a full sheet table
   heatBg / pctColor / rankChipClass are kept for old callers (no longer used by table()).
   Needs tdc-sheets.css on the page. */
(function(){
  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
  function heatBg(pct){
    if(pct==null||isNaN(pct)) return 'transparent';
    pct=clamp(pct,0,100);
    var a=0.03+(pct/100)*0.30; return 'rgba(var(--pd-ink-rgb,26,42,76),'+a.toFixed(3)+')';
  }
  function pctColor(pct){
    if(pct==null||isNaN(pct)) return 'var(--text3)';
    var a=pct>=90?1:pct>=75?.84:pct>=50?.68:pct>=30?.52:.40;
    return 'rgba(var(--pd-ink-rgb,26,42,76),'+a+')';
  }
  function rankChipClass(r){ return r<=3?'r-gold':(r<=10?'r-silver':'r-plain'); }
  function ord(p){
    if(p==null||isNaN(p)) return '';
    p=Math.round(p); var s=['th','st','nd','rd'], v=p%100;
    return p+(s[(v-20)%10]||s[v]||s[0]);
  }
  function bucket(p){
    if(p==null||isNaN(p)) return '';
    return p<20?'c0':p<40?'c1':p<60?'c2':p<80?'c3':'c4';
  }
  function attr(v){ return String(v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
  function ensureCss(){
    if(typeof document==='undefined'||document.getElementById('tdc-heat-sheet-css')) return;
    var s=document.createElement('style'); s.id='tdc-heat-sheet-css';
    s.textContent='.sheet.hl-sheet tr.tot td{font-weight:800;color:var(--text);border-top:2px solid var(--border2);}'
      +'.sheet.hl-sheet tr.grp td{font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);background:var(--bg2);}';
    document.head.appendChild(s);
  }

  // cfg = {
  //   cols:[{k,label,left,sticky,fmt,pctKey,invert,title}],  // column defs
  //   rows:[{...data, _pct:{k:pctVal}, _rank:{k:rankVal}, _total, _grouphd}]
  // }
  function cell(col,row){
    var raw=row[col.k];
    var disp=(col.fmt?col.fmt(raw,row):raw);
    if(disp==null||disp===''||disp==='NaN') return '<td class="dim">—</td>';
    var pct = row._pct && (col.pctKey!=null) ? row._pct[col.pctKey!==true?col.pctKey:col.k] : null;
    if(pct!=null&&col.invert) pct=100-pct;
    var rank = row._rank ? row._rank[col.k] : null;
    var tip=[];
    if(pct!=null&&!isNaN(pct)) tip.push(ord(pct)+' percentile');
    if(rank!=null) tip.push('#'+rank);
    var b=bucket(pct);
    return '<td'+(b?' class="'+b+'"':'')+(tip.length?' title="'+attr(tip.join(' · '))+'"':'')+'>'+disp+'</td>';
  }
  function table(cfg){
    ensureCss();
    var cols=cfg.cols||[], rows=cfg.rows||[];
    var nSticky=0; for(var i=0;i<cols.length&&cols[i].sticky;i++) nSticky++;
    var frz=nSticky>=2?' freeze2':(nSticky===1?' freeze':'');
    var head='<tr>'+cols.map(function(c){
      return '<th'+(c.left?' class="l"':'')+(c.title?' title="'+attr(c.title)+'"':'')+'>'+c.label+'</th>';
    }).join('')+'</tr>';
    var body=rows.map(function(r){
      if(r._grouphd) return '<tr class="grp"><td class="l" colspan="'+cols.length+'">'+r._grouphd+'</td></tr>';
      return '<tr'+(r._total?' class="tot"':'')+'>'+cols.map(function(c,j){
        if(c.left){ // identity cell rendered raw (may contain markup)
          var v=(c.fmt?c.fmt(r[c.k],r):r[c.k]);
          return '<td class="l'+(j===0?' nm':' dim')+'">'+(v==null?'':v)+'</td>';
        }
        return cell(c,r);
      }).join('')+'</tr>';
    }).join('');
    var st=cfg.freezeWidths?(' style="'+attr(cfg.freezeWidths)+'"'):'';
    return '<div class="sheet-wrap"><table class="sheet dense'+frz+' hl-sheet"'+st+'>'
      +'<thead>'+head+'</thead><tbody>'+body+'</tbody></table></div>';
  }

  window.TDCHeat={ heatBg:heatBg, pctColor:pctColor, rankChipClass:rankChipClass, ord:ord, bucket:bucket, table:table };
})();
