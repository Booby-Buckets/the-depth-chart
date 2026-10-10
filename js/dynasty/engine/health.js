// Wear and tear (Oct 2026). Every player has a SEASON health pool (0-100) and a CAREER pool (the ceiling the season
// pool can recover to). Minutes wear him down (more past his stamina threshold); days off recover him. A worn-down
// player plays tired (counted like extra minutes past his threshold in the fatigue model) and gets hurt more. At the
// end of a season the career pool pays for a hard year, and next season's pool starts lower if he finished empty —
// how hard you ride a player is a decision about his career. ROTATION STRATEGY (user's Program / Roster tab): keep
// legs fresh (starters ~2.5 fewer minutes), balanced, or ride the starters (~2 more). Pure: works on the state object.
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const ROT = [['fresh', 'Keep legs fresh'], ['normal', 'Balanced'], ['grind', 'Ride the starters']];

export const hpOf = p => (p.hp ?? 100);
export const careerOf = p => (p.chp ?? 100);
const dayN = iso => Math.round(Date.parse(iso + 'T12:00:00Z') / 864e5);

/** after a game: recovery since his last one, then this game's wear */
export function wear(state, g, rows) {
  const today = dayN(g.d);
  for (const r of rows) {
    const p = state.players[r.id]; if (!p) continue;
    const rest = p.hpD ? clamp(today - p.hpD, 0, 10) : 3;
    const cap = careerOf(p);
    let hp = Math.min(cap, hpOf(p) + 2.6 * rest);
    const thr = 28 + (p.sta ?? 50) / 9, min = r.min || 0;
    hp -= min * 0.16 + Math.max(0, min - thr) * 0.5;
    p.hp = Math.round(clamp(hp, 0, cap) * 10) / 10; p.hpD = today;
  }
}
/** a worn player: extra 'minutes past threshold' for the fatigue model + an injury-risk multiplier */
export const tiredness = p => Math.max(0, (70 - hpOf(p)) / 8);
export const injuryRisk = p => 1 + Math.max(0, 60 - hpOf(p)) / 80;

/** the summer: a hard season costs career health; next year's pool starts lower if he finished empty */
export function offseasonHealth(state) {
  for (const p of Object.values(state.players)) {
    const end = hpOf(p);
    p.chp = Math.round(clamp(careerOf(p) - (100 - end) * 0.08 - (p.yr >= 4 ? 1 : 0), 55, 100) * 10) / 10;
    p.hp = Math.round(Math.min(p.chp, 100 - (100 - end) * 0.25) * 10) / 10;
    p.hpD = null;
  }
}
/** the rotation strategy's minutes: shift starters' minutes to / from the bench */
export function rotate(minutes, ids, rot) {
  if (!rot || rot === 'normal') return minutes;
  const m = Object.assign({}, minutes), d = rot === 'fresh' ? -2.5 : 2, top = ids.slice(0, 5), bench = ids.slice(5, 9);
  let moved = 0;
  for (const id of top) { const was = m[id] || 0, nu = clamp(was + d, 0, 40); moved += was - nu; m[id] = nu; }
  for (const id of bench) m[id] = Math.max(0, (m[id] || 0) + moved / Math.max(1, bench.length));
  return m;
}
