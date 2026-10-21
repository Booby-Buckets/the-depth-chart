/* tdc-credit.js — the Skill Fingerprint's credit model for ONE game, in the browser (window.TDC_CREDIT) and in Node.
 * A line-for-line port of tally() in scripts/build_fingerprint.py (keep the two in step): every play moves the
 * possession's expected value against B (an average possession), and the change is credited to the players
 * involved; the defense's leftover share goes to the team by minutes. Used by the game recap (tdc-recap.js).
 *
 *   TDC_CREDIT.game(summary, {B, league:{r, rf, f}})
 *     -> { teams:[id,id], names:{pid:name}, team:{pid:teamId}, min:{pid:min},
 *          players:{pid:{t, min, poss, tot, o, d, sk:{skill:pts}}}, side:{teamId:{off:{skill:pts}, def:{skill:pts}, poss}} }
 * Single-game numbers are raw points added (not per 100, not schedule-adjusted): "what he added tonight".
 */
(function (root) {
  'use strict';
  var A_Z = { rim: 0.40, put: 0.10, mid: 0.25, three: 0.30 };
  var STEAL_SH = 0.70, BLOCK_SH = 0.50, REB_SH = 0.70;
  var SKILLS = [['rim', 'Rim finishing', 'Scoring'], ['put', 'Putbacks', 'Scoring'], ['mid', 'Mid-range', 'Scoring'],
    ['three', 'Three-point shooting', 'Scoring'], ['ft', 'Free throws', 'Scoring'], ['self', 'Self-creation', 'Creation'],
    ['pass', 'Passing', 'Creation'], ['drawn', 'Drawing fouls', 'Creation'], ['tov', 'Ball security', 'Creation'],
    ['oreb', 'Offensive rebounding', 'Rebounding'], ['dreb', 'Defensive rebounding', 'Rebounding'], ['stl', 'Steals', 'Defense'],
    ['blk', 'Blocks', 'Defense'], ['foul', 'Fouls', 'Defense'], ['team', 'Team defense', 'Defense']];
  var OFF = { rim: 1, put: 1, mid: 1, three: 1, ft: 1, self: 1, pass: 1, drawn: 1, tov: 1, oreb: 1 };
  var DIST = /(\d+)-foot/, FT_OF = /free throw (\d) of (\d)/i;

  function zone(p, pa) {
    if ((pa || p.pointsAttempted || 0) === 3) return 'three';
    var ty = p.type.text, tx = (p.text || '').toLowerCase();
    if (ty === 'TipShot' || tx.indexOf('tip') > -1 || tx.indexOf('putback') > -1) return 'put';
    if (ty === 'DunkShot' || ty === 'LayUpShot' || tx.indexOf('layup') > -1 || tx.indexOf('dunk') > -1) return 'rim';
    var m = DIST.exec(tx); return (m && +m[1] <= 4) ? 'rim' : 'mid';
  }
  function parse(s) {
    var comp = ((s.header || {}).competitions || [{}])[0];
    var teams = (comp.competitors || []).map(function (c) { return String(c.id); });
    if (teams.length !== 2) return null;
    var mins = {}, names = {}; teams.forEach(function (t) { mins[t] = {}; });
    ((s.boxscore || {}).players || []).forEach(function (bp) {
      var tid = String(bp.team.id), st = (bp.statistics || [{}])[0], keys = st.keys || [];
      if (!mins[tid] || keys.indexOf('minutes') < 0) return;
      var ki = keys.indexOf('minutes');
      (st.athletes || []).forEach(function (a) { var m = parseFloat(a.stats && a.stats[ki]); if (m > 0) { var pid = String(a.athlete.id); mins[tid][pid] = m; names[pid] = a.athlete.displayName; } });
    });
    return { teams: teams, mins: mins, names: names, plays: s.plays || [] };
  }
  function tally(plays, teams, L) {
    var other = {}; other[teams[0]] = teams[1]; other[teams[1]] = teams[0];
    var rows = [], cnt = {}; teams.forEach(function (t) { cnt[t] = { fga: 0, pts: 0, fta: 0, tov: 0, oreb: 0 }; });
    var lastMiss = null, lastFoul = {}, trip = null, lastMake = null, missBox = null;
    var curSeq = null;
    var add = function (r) { r.push(curSeq); rows.push(r); };
    function closeTrip() {
      if (!trip) return;
      var andone = trip.n == null ? (trip.afterMake && trip.att === 1) : trip.andone, f = L.f;
      if (trip.missLast) missBox = ['ft', trip.t];
      var bTot = (andone ? 0 : -1) + (trip.missLast ? L.rf : 0);
      add([trip.t, trip.pid, 'ft', trip.made - f * trip.att, 0, false]);
      add([trip.t, trip.pid, 'drawn', f * trip.att, bTot, false]);
      if (trip.fouler) add([trip.t, trip.fouler, 'foul', -f * trip.att, -bTot, true]);
      trip = null;
    }
    plays.forEach(function (p) {
      var ty = p.type.text, tx = p.text || '', tl = tx.toLowerCase();
      var tid = String((p.team || {}).id || '');
      var parts = (p.participants || []).filter(function (x) { return x.athlete; }).map(function (x) { return String(x.athlete.id); });
      var clock = ((p.period || {}).number) + '|' + ((p.clock || {}).displayValue);
      if (!(tid in other)) return;
      curSeq = String(p.sequenceNumber || p.id || '');
      var isFt = tl.indexOf('free throw') > -1 || ty.indexOf('FreeThrow') > -1;
      if (trip && !(isFt && tid === trip.t) && ['Substitution', 'ShortTimeOut', 'RegularTimeOut', 'OfficialTVTimeOut', 'Dead Ball Rebound'].indexOf(ty) < 0) {
        closeTrip(); if (missBox) { lastMiss = missBox; missBox = null; }
      }
      if (ty === 'PersonalFoul' || (/Foul$/.test(ty) && tl.indexOf('technical') < 0)) { if (parts.length) lastFoul[tid] = [parts[0], clock]; return; }
      if (isFt) {
        var m = FT_OF.exec(tx), k = m ? +m[1] : null, n = m ? +m[2] : null, made = p.scoringPlay ? 1 : 0;
        cnt[tid].fta++; cnt[tid].pts += made;
        if (tl.indexOf('technical') > -1) { add([tid, parts[0] || null, 'ft', made - L.f, 0, false]); return; }
        if (!trip) {
          var fl = lastFoul[other[tid]];
          trip = { t: tid, pid: parts[0] || null, made: 0, att: 0, andone: n === 1 && lastMake === tid + '#' + clock, n: n,
                   afterMake: lastMake === tid + '#' + clock, missLast: false, fouler: fl ? fl[0] : null };
        }
        trip.made += made; trip.att++;
        trip.missLast = n == null ? made === 0 : (made === 0 && k >= n);
        if (n != null && k >= n) { closeTrip(); if (missBox) { lastMiss = missBox; missBox = null; } }
        return;
      }
      // older feeds leave pointsAttempted at 0: then the value is in the text ("Three Point Jumper")
      var pa = (!isFt && p.shootingPlay) ? ((p.pointsAttempted === 2 || p.pointsAttempted === 3) ? p.pointsAttempted : (tl.indexOf('three point') > -1 ? 3 : 2)) : 0;
      if (pa) {
        var z = zone(p, pa), sh = parts[0] || null, pts = pa;
        cnt[tid].fga++;
        if (p.scoringPlay) {
          cnt[tid].pts += pts; lastMake = tid + '#' + clock; lastMiss = null;
          var ast = (parts.length > 1 && tl.indexOf('assist') > -1) ? parts[1] : null, a = A_Z[z];
          add([tid, sh, z, (1 - a) * pts, -(1 - a), false]);
          add(ast ? [tid, ast, 'pass', a * pts, -a, false] : [tid, sh, 'self', a * pts, -a, false]);
        } else { add([tid, sh, z, 0, -(1 - L.r), false]); lastMiss = ['fg', tid]; }
        return;
      }
      if (ty === 'Block Shot') { if (parts.length) add([other[tid], parts[0], 'blk', 0, BLOCK_SH * (1 - L.r), true]); return; }
      if (ty.indexOf('Rebound') > -1) {
        if (!lastMiss) return;
        var kind = lastMiss[0], shotT = lastMiss[1]; lastMiss = null;
        var r = kind === 'fg' ? L.r : L.rf, pid = parts[0] || null;
        if (tid === shotT) { cnt[tid].oreb++; add([tid, pid, 'oreb', 0, REB_SH * (1 - r), false]); add([tid, null, '_oreb', 0, (1 - REB_SH) * (1 - r), false]); }
        else { add([shotT, null, '_dreb', 0, -r, false]); if (pid) add([shotT, pid, 'dreb', 0, REB_SH * r, true]); }
        return;
      }
      if (ty.indexOf('Turnover') > -1) { cnt[tid].tov++; lastMiss = null; add([tid, parts[0] || null, 'tov', 0, -1, false]); return; }
      if (ty === 'Steal') { if (parts.length) add([other[tid], parts[0], 'stl', 0, STEAL_SH, true]); return; }
    });
    closeTrip();
    return { rows: rows, cnt: cnt };
  }
  function game(summary, opt) {
    var g = parse(summary); if (!g || !g.plays.length) return null;
    var B = opt.B, L = opt.league, T = tally(g.plays, g.teams, L), rows = T.rows;
    var other = {}; other[g.teams[0]] = g.teams[1]; other[g.teams[1]] = g.teams[0];
    var players = {}, side = {}, team = {};
    var P = function (pid, t) { return players[pid] || (players[pid] = { t: t, min: g.mins[t][pid] || 0, poss: 0, sk: {}, tot: 0, o: 0, d: 0 }); };
    g.teams.forEach(function (t) {
      var o = other[t], c = T.cnt[t], poss = c.fga - c.oreb + c.tov + 0.44 * c.fta;
      var tm = 0; for (var k in g.mins[t]) tm += g.mins[t][k]; tm = tm || 200;
      side[t] = { off: {}, def: {}, poss: poss };
      Object.keys(g.mins[t]).forEach(function (pid) { var q = P(pid, t); team[pid] = t; q.poss = poss * q.min / (tm / 5); });
      var tot = 0, carved = 0;
      rows.forEach(function (r) {
        var v = r[3] + r[4] * B;
        if (r[0] === t && !r[5]) { side[t].off[r[2]] = (side[t].off[r[2]] || 0) + v; if (r[1] && r[2][0] !== '_' && g.mins[t][r[1]] != null) { var q = P(r[1], t); q.sk[r[2]] = (q.sk[r[2]] || 0) + v; } }
        if (r[0] === o && !r[5]) tot -= v;
        if (r[0] === o && r[5] && r[1] && g.mins[t][r[1]] != null) { var q2 = P(r[1], t); q2.sk[r[2]] = (q2.sk[r[2]] || 0) + v; side[t].def[r[2]] = (side[t].def[r[2]] || 0) + v; carved += v; }
      });
      side[t].def.team = tot - carved;
      Object.keys(g.mins[t]).forEach(function (pid) { var q = P(pid, t); q.sk.team = (q.sk.team || 0) + (tot - carved) * q.min / tm; });
    });
    Object.keys(players).forEach(function (pid) {
      var q = players[pid]; q.o = 0; q.d = 0;
      for (var k in q.sk) { if (OFF[k]) q.o += q.sk[k]; else q.d += q.sk[k]; }
      q.tot = q.o + q.d;
    });
    return { teams: g.teams, names: g.names, team: team, min: g.mins, players: players, side: side };
  }
  var api = { game: game, tally: tally, parse: parse, SKILLS: SKILLS, OFF: OFF };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TDC_CREDIT = api;
})(typeof window !== 'undefined' ? window : globalThis);
