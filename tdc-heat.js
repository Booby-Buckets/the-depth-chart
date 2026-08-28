/* tdc-heat.js — reusable heat-grade table renderer (nbarapm-style).
   TDCHeat.heatBg(pct)      -> rgba tint (green good / blue below-avg), pct 0-100
   TDCHeat.pctColor(pct)    -> solid text color for the percentile subscript
   TDCHeat.rankChipClass(r) -> 'r-gold' | 'r-silver' | 'r-plain'
   TDCHeat.table(cfg)       -> HTML string for a full heat table
   No dependencies; safe to load anywhere. */
(function(){
  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
  // Green above 50th, blue below — intensity scales with distance from average.
  function heatBg(pct){
    if(pct==null||isNaN(pct)) return 'transparent';
    pct=clamp(pct,0,100);
    if(pct>=50){ var a=(pct-50)/50*0.30; return 'rgba(45,224,166,'+a.toFixed(3)+')'; }
    var b=(50-pct)/50*0.26; return 'rgba(91,141,239,'+b.toFixed(3)+')';
  }
  function pctColor(pct){
    if(pct==null||isNaN(pct)) return 'var(--text3)';
    return pct>=90?'#E0B24A':pct>=75?'#2DE0A6':pct>=50?'#7FE8C4':pct>=30?'#8FA0C4':'#E06A7A';
  }
  function rankChipClass(r){ return r<=3?'r-gold':(r<=10?'r-silver':'r-plain'); }
  function ord(p){
    if(p==null||isNaN(p)) return '';
    p=Math.round(p); var s=['th','st','nd','rd'], v=p%100;
    return p+(s[(v-20)%10]||s[v]||s[0]);
  }

  // cfg = {
  //   cols:[{k,label,left,fmt,pctKey,invert,rank}],  // column defs
  //   rows:[{...data, _pct:{k:pctVal}, _rank:{k:rankVal}}],
  //   minWidth, showPctSub (default true)
  // }
  function cell(col,row){
    var raw=row[col.k];
    var disp=(col.fmt?col.fmt(raw,row):raw);
    if(disp==null||disp===''||disp==='NaN') return '<td><span class="hl-cell"><span class="hl-na">—</span></span></td>';
    var pct = row._pct && (col.pctKey!=null) ? row._pct[col.pctKey!==true?col.pctKey:col.k] : null;
    if(pct!=null&&col.invert) pct=100-pct;
    var rank = row._rank ? row._rank[col.k] : null;
    var bg = pct!=null ? heatBg(pct) : 'transparent';
    var sub='';
    if(rank!=null){ sub='<span class="hl-rank '+rankChipClass(rank)+'">'+rank+'</span>'; }
    else if(pct!=null){ sub='<span class="hl-s" style="color:'+pctColor(pct)+'">'+ord(pct)+'</span>'; }
    return '<td style="background:'+bg+'"><span class="hl-cell'+(col.center?' c-c':'')+'">'
      +'<span class="hl-v">'+disp+'</span>'+sub+'</span></td>';
  }
  function table(cfg){
    var cols=cfg.cols||[], rows=cfg.rows||[];
    var head='<tr>'+cols.map(function(c){
      var cls=(c.left?'hl-l':'')+(c.sticky?' hl-sticky':'');
      return '<th'+(cls?' class="'+cls.trim()+'"':'')+(c.title?' title="'+c.title+'"':'')+'>'+c.label+'</th>';
    }).join('')+'</tr>';
    var body=rows.map(function(r){
      if(r._grouphd) return '<tr class="hl-grouphd"><td colspan="'+cols.length+'">'+r._grouphd+'</td></tr>';
      var tr='<tr'+(r._total?' class="hl-total"':'')+'>';
      tr+=cols.map(function(c){
        if(c.left){ // identity cell rendered raw (may contain markup)
          var v=(c.fmt?c.fmt(r[c.k],r):r[c.k]);
          return '<td class="hl-l'+(c.sticky?' hl-sticky':'')+'">'+(v==null?'':v)+'</td>';
        }
        return cell(c,r);
      }).join('');
      return tr+'</tr>';
    }).join('');
    return '<div class="tdc-heat-wrap"><table class="tdc-heat" style="min-width:'+(cfg.minWidth||640)+'px">'
      +'<thead>'+head+'</thead><tbody>'+body+'</tbody></table></div>';
  }

  window.TDCHeat={ heatBg:heatBg, pctColor:pctColor, rankChipClass:rankChipClass, ord:ord, table:table };
})();
