// Turn a game's event log into play-by-play lines with a running score and clock.
const half = t => (t < 1200 ? 1 : t < 2400 ? 2 : 3 + Math.floor((t - 2400) / 300));
export function clock(t) {
  const h = half(t);
  const left = h <= 2 ? 1200 - (t - (h - 1) * 1200) : 300 - ((t - 2400) % 300);
  const m = Math.floor(left / 60), s = Math.floor(left % 60);
  return { period: h <= 2 ? (h === 1 ? '1st' : '2nd') : (h === 3 ? 'OT' : `${h - 2}OT`), clock: `${m}:${String(s).padStart(2, '0')}` };
}
export function lines(events, nameOf, teams) {
  const sc = [0, 0], out = [];
  const N = id => (id == null ? 'Team' : nameOf(id));
  for (const e of events) {
    let txt = null, pts = 0;
    if (e.ty === 'fg2' || e.ty === 'fg3') {
      const three = e.ty === 'fg3';
      if (e.m) {
        pts = (three ? 3 : 2) + (e.and1 || 0);
        txt = `${N(e.p)} ${three ? 'drains a three' : 'scores inside'}${e.ast ? ` (assist ${N(e.ast)})` : ''}${e.and1 ? ' — and one!' : ''}`;
      } else txt = `${N(e.p)} misses a ${three ? 'three' : 'two'}${e.blk ? ` — blocked by ${N(e.blk)}` : ''}`;
    } else if (e.ty === 'ft') { pts = e.m; txt = `${N(e.p)} makes ${e.m} of ${e.n} free throws`; }
    else if (e.ty === 'to') txt = `${N(e.p)} turns it over${e.stl ? ` — stolen by ${N(e.stl)}` : ''}`;
    else if (e.ty === 'orb') txt = e.p ? `Offensive rebound, ${N(e.p)}` : 'Offensive rebound (team)';
    else if (e.ty === 'drb') txt = e.p ? `Rebound ${N(e.p)}` : 'Defensive rebound (team)';
    else if (e.ty === 'pf') txt = `Foul on ${N(e.p)}`;
    else if (e.ty === 'sub') txt = `Sub: ${e.in.map(N).join(', ')} in for ${e.out.map(N).join(', ')}`;
    if (!txt) continue;
    sc[e.s] += pts;
    // rebounds / fouls / steals belong to the defending side
    const side = (e.ty === 'drb' || e.ty === 'pf') ? 1 - e.s : e.s;
    out.push(Object.assign({ t: e.t, side, team: teams[side], txt, pts, score: [sc[0], sc[1]], sub: e.ty === 'sub' }, clock(e.t)));
  }
  return out;
}
