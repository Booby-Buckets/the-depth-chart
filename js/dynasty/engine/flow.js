// The dynasty's phase machine: regular season -> conference tournaments -> NCAA -> done (-> offseason).
// Pure. The UI calls simNext / simTo; each simulated day is followed by afterDay, which schedules the next
// postseason round or moves the phase on.
import { simDay, nextDate } from './season.js?v=10';
import { startConferenceTournaments, advance } from './postseason.js?v=10';
import { computeAwards } from './awards.js?v=10';

export function afterDay(state) {
  if (state.phase === 'regular' && !nextDate(state)) startConferenceTournaments(state);
  else if (state.phase === 'conftourney' || state.phase === 'ncaa') advance(state);
  if (state.phase === 'done' && !state.awards) computeAwards(state);
}

export function simNext(state, C, cache, opts) {
  if (!nextDate(state)) { afterDay(state); if (!nextDate(state)) return null; }
  const r = simDay(state, C, cache, opts);
  afterDay(state);
  return r;
}

// keep simming days until stop(state) or nothing is left to play this season
export function simTo(state, C, cache, stop, opts) {
  let days = 0;
  while (!stop(state)) { if (!simNext(state, C, cache, opts)) break; days++; }
  return days;
}
