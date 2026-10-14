/* lib_shotfamily.mjs — the shot families behind Mastery Shots (shared by build_mastery.mjs and
 * build_possession_value.mjs; the page mirror is tdc-mastery.js SHOTS).
 *   rim    layups / dunks / tips, or any two within 4 ft
 *   float  floaters / runners                      ┐
 *   post   hooks, turnarounds, fadeaways           │ tagged by ESPN's text — 2025-26 on
 *   pull2  pull-up / step-back twos                ┘
 *   short  other two-point jumpers, 5-14 ft
 *   long   other two-point jumpers, 15 ft to the arc
 *   mid    two-point jumpers with no distance in the feed
 *   pull3  pull-up / step-back threes (tagged, 2025-26 on)
 *   three  every other three
 */
export const FAM = ['rim', 'float', 'post', 'pull2', 'short', 'long', 'mid', 'pull3', 'three'];
export const SV = { pull3: 3, three: 3 };
// green-light floors per shot option (attempts), as in tdc-mastery.js
export const OPTS = {
  jump2: { fams: ['float', 'post', 'pull2', 'short', 'long', 'mid'], floor: 75 },
  float: { fams: ['float'], floor: 30 },
  post: { fams: ['post'], floor: 30 },
  pull2: { fams: ['pull2'], floor: 30 },
  pull3: { fams: ['pull3'], floor: 25 },
  three: { fams: ['three', 'pull3'], floor: 100 },
};
export const BAR = 1.1;

const tt = (p) => (p.type && p.type.text) || '';
export const isFG = (p) => p.shootingPlay && !/FreeThrow|Free Throw/i.test(tt(p) + ' ' + (p.text || ''));

export function family(p) {
  const t = (p.text || '').toLowerCase(), ty = tt(p);
  const three = (+p.pointsAttempted || +p.scoreValue || 0) === 3 || /three point/.test(t);
  const pull = /pull-?up|step ?back/.test(t);
  if (three) return pull ? 'pull3' : 'three';
  if (/floating|floater|runner/.test(t)) return 'float';
  if (/LayUp|Dunk|Tip/i.test(ty) || /layup|dunk|tip/.test(t)) return 'rim';
  if (/hook|turnaround|fade/.test(t)) return 'post';
  if (pull) return 'pull2';
  let d = null;
  const m = /(\d+)-foot/.exec(t);
  if (m) d = +m[1];
  else if (p.coordinate && isFinite(p.coordinate.x) && isFinite(p.coordinate.y) && !(p.coordinate.x === 25 && p.coordinate.y === 0) && p.coordinate.y >= 0 && p.coordinate.y < 47)
    d = Math.hypot(p.coordinate.x - 25, p.coordinate.y);
  if (d == null) return 'mid';
  return d <= 4 ? 'rim' : d <= 14 ? 'short' : 'long';
}

// a player's green lights from his mastery row's counts (FAM×[att, made, ast])
export function greenLights(counts) {
  const g = {};
  for (const [k, o] of Object.entries(OPTS)) {
    let att = 0, pts = 0;
    for (const f of o.fams) { const i = FAM.indexOf(f) * 3; att += counts[i]; pts += counts[i + 1] * (SV[f] || 2); }
    g[k] = att >= o.floor && pts / att >= BAR;
  }
  return g;
}
// Schertz's early-shot grades: great = rim or a shot he has proven; average = an unproven three; bad = an unproven tough two / pull-up three
export function grade(fam, g) {
  if (fam === 'rim') return 'great';
  if (fam === 'three') return g && g.three ? 'great' : 'avg';
  if (fam === 'pull3') return g && g.pull3 ? 'great' : 'bad';
  if (g && (g.jump2 || g[fam])) return 'great';
  return 'bad';
}
