/* tdc-sheets.js — behaviour for the shared sheet tables (tdc-sheets.css).
   tdcSheetHeat(table): shades each column whose <th> has data-heat="1" (higher is better) or
   data-heat="-1" (lower is better) in five buckets, c0 (bottom fifth) to c4 (top fifth), over
   the rows in that table — the same scale as the rankings table and the CFB site. A cell's value
   is its data-v attribute if present, else its text ("44.2%", "+3.1" and "12" all read). Cells
   with no number stay unshaded. Safe to call again after cells are filled in or re-sorted.
   Rows with data-noheat get shaded on the other rows' scale without moving it.
   tdcSheetHeat(table, ref): bucket against ANOTHER table's column (same header order) — e.g. a
   three-row scrimmage table shaded on the season table's scale, so equal numbers get equal colours. */
(function(){
  function val(td){
    var raw = td.getAttribute('data-v'); if(raw == null) raw = td.textContent;
    var n = parseFloat(String(raw).replace(/[%+,$\s]/g, '').replace('−', '-'));
    return isFinite(n) ? n : null;
  }
  window.tdcSheetHeat = function(table, ref){
    if(!table || !table.tHead || !table.tBodies[0]) return;
    var head = table.tHead.rows[table.tHead.rows.length - 1]; if(!head) return;
    // rows marked data-noheat are shaded on the others' scale but never move it
    var all = [].slice.call(table.tBodies[0].rows).filter(function(r){ return r.cells.length === head.cells.length; });
    var rows = all, scale = all.filter(function(r){ return !r.hasAttribute('data-noheat'); });
    [].forEach.call(head.cells, function(th, j){
      var dir = +th.getAttribute('data-heat'); if(!dir) return;
      var cells = rows.map(function(r){ return r.cells[j]; });
      var vals = cells.map(val);
      var src = scale.map(function(r){ return val(r.cells[j]); });
      if(ref && ref.tHead && ref.tBodies[0]){
        var rh = ref.tHead.rows[ref.tHead.rows.length - 1];
        src = [].slice.call(ref.tBodies[0].rows).filter(function(r){ return r.cells.length === rh.cells.length && !r.hasAttribute('data-noheat'); })
          .map(function(r){ return val(r.cells[j]); });
      }
      var nums = src.filter(function(v){ return v != null; }).sort(function(a, b){ return a - b; });
      cells.forEach(function(c){ c.classList.remove('c0', 'c1', 'c2', 'c3', 'c4'); });
      if(nums.length < 4 || nums[0] === nums[nums.length - 1]) return;
      var cuts = [.2, .4, .6, .8].map(function(p){ return nums[Math.floor(p * (nums.length - 1))]; });
      cells.forEach(function(c, i){
        var v = vals[i]; if(v == null) return;
        var b = cuts.filter(function(x){ return v > x; }).length; if(dir < 0) b = 4 - b;
        c.classList.add('c' + b);
      });
    });
  };
})();
