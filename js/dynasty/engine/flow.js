// The dynasty's phase machine: regular season -> conference tournaments -> NCAA -> done (-> offseason).
// Pure. The UI calls simNext / simTo; each simulated day is followed by afterDay, which schedules the next
// postseason round or moves the phase on.
import { simDay, nextDate, touch } from './season.js?v=58';
import { startConferenceTournaments, advance } from './postseason.js?v=58';
import { computeAwards } from './awards.js?v=58';
import { programWeek } from './program.js?v=58';
import { landOdds } from './offseason.js?v=58';
import { recruitWeek, isNewClass } from './commits.js?v=58';
// the recruiting board's week-to-week arrows: your odds on the recruits you're working (targets, visits, NIL offers)
function trends(state) {
  if (!state.user || !state.rclass) return;
  const T = new Set(state.targets || []), V = new Set((state.visits || []).map(v => v.rid));
  for (const r of state.rclass) if (T.has(r.id) || V.has(r.id) || r.offer) { r.oddsPrev = r.odds; r.odds = Math.round(1000 * landOdds(state, r, 20)) / 1000; }
}

// the program's week: every 7 days of the calendar the staff + hours turn into familiarity, focus growth,
// recruiting points and NIL money (all teams), then the prepared teams are rebuilt
function weekTick(state, d) {
  if (!d) return;
  if (!state.progT) { state.progT = d; return; }
  const days = (Date.parse(d + 'T12:00:00Z') - Date.parse(state.progT + 'T12:00:00Z')) / 864e5;
  if (days >= 7) {
    const n = Math.floor(days / 7);
    programWeek(state, n); state.progT = d;
    if (isNewClass(state.rclass) && state.phase !== 'offseason') for (let i = 0; i < n; i++) recruitWeek(state, d);   // the recruiting race (commits.js)
    else trends(state);
    touch(state);
  }
}
export function afterDay(state, d) {
  weekTick(state, d);
  if (state.phase === 'regular' && !nextDate(state)) startConferenceTournaments(state);
  else if (state.phase === 'conftourney' || state.phase === 'ncaa') advance(state);
  if (state.phase === 'done' && !state.awards) computeAwards(state);
}

export function simNext(state, C, cache, opts) {
  if (!nextDate(state)) { afterDay(state); if (!nextDate(state)) return null; }
  const r = simDay(state, C, cache, opts);
  afterDay(state, r && r.date);
  return r;
}

// keep simming days until stop(state) or nothing is left to play this season
export function simTo(state, C, cache, stop, opts) {
  let days = 0;
  while (!stop(state)) { if (!simNext(state, C, cache, opts)) break; days++; }
  return days;
}
