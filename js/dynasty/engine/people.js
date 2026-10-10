// Durability, academics and international players (Oct 2026, owner: "some are more injury prone than others · recruit
// international players · academic requirements: some recruits or transfers might not meet that and it is harder for
// high-academic universities to admit players · schools closer to international airports or in bigger cities do
// better with international players"). Pure: works on the state object.
//
//   p.prone   injury proneness (x the injury rate): ~0.5 iron man .. ~2.5 fragile. Real players start from last season
//             (one who missed time starts more fragile); a serious injury makes the next one likelier.
//   p.acad    academic profile 0-100 (GPA / coursework). Below the NCAA minimum (22) nobody in D-I can sign him.
//   t.acad    a school's admissions bar 0-100 (Ivy, Stanford, Duke ... ~95; most schools 35-60). Athletes get a lot of
//             slack, but an elite school still can't take a weak student, and takes transfers less readily.
//   p.country an international player's home country; t.intl (0-1) = a school's international access (closest major
//             international airport + city size, data/dynasty-geo.json) — what an international recruit weighs
//             instead of distance from home.
import { makeRng, hashSeed } from './rng.js?v=50';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const NCAA_MIN = 22;
const ELITE = ['Harvard Crimson', 'Yale Bulldogs', 'Princeton Tigers', 'Pennsylvania Quakers', 'Columbia Lions', 'Brown Bears', 'Dartmouth Big Green', 'Cornell Big Red',
  'Stanford Cardinal', 'Duke Blue Devils', 'Northwestern Wildcats', 'Vanderbilt Commodores', 'Rice Owls', 'Army Black Knights', 'Navy Midshipmen', 'Air Force Falcons'];
const HIGH = { 'Notre Dame Fighting Irish': 86, 'Georgetown Hoyas': 85, 'California Golden Bears': 84, 'UCLA Bruins': 84, 'Michigan Wolverines': 83, 'Virginia Cavaliers': 82,
  'USC Trojans': 82, 'Georgia Tech Yellow Jackets': 82, 'Boston College Eagles': 80, 'Wake Forest Demon Deacons': 80, 'Tulane Green Wave': 80, 'North Carolina Tar Heels': 79,
  'Villanova Wildcats': 78, 'Davidson Wildcats': 80, 'Bucknell Bison': 78, 'Lehigh Mountain Hawks': 77, 'Lafayette Leopards': 77, 'Holy Cross Crusaders': 78, 'Colgate Raiders': 79,
  'Richmond Spiders': 76, 'William & Mary Tribe': 78, 'Boston University Terriers': 74, 'Santa Clara Broncos': 74, 'SMU Mustangs': 72, 'Miami Hurricanes': 72, 'Pepperdine Waves': 72,
  'San Diego Toreros': 70, 'UC San Diego Tritons': 76, 'UC Davis Aggies': 72, 'UC Irvine Anteaters': 72, 'UC Santa Barbara Gauchos': 72, 'Wisconsin Badgers': 72, 'Illinois Fighting Illini': 70,
  'Texas Longhorns': 70, 'Florida Gators': 72, 'Washington Huskies': 70, 'Maryland Terrapins': 68, 'Purdue Boilermakers': 66, 'Ohio State Buckeyes': 66, 'Northeastern Huskies': 74,
  'Fordham Rams': 68, 'American University Eagles': 70, 'Loyola Maryland Greyhounds': 66, 'Furman Paladins': 68, 'Butler Bulldogs': 66, 'Creighton Bluejays': 66, 'Marquette Golden Eagles': 65,
  'Elon Phoenix': 64, 'Belmont Bruins': 62, 'Saint Louis Billikens': 64, 'Loyola Chicago Ramblers': 64, 'Providence Friars': 64, 'Seton Hall Pirates': 60, 'Xavier Musketeers': 62,
  'Dayton Flyers': 62, 'Wofford Terriers': 66, 'Samford Bulldogs': 60, 'Mercer Bears': 62, 'Cal Poly Mustangs': 66, 'George Washington Revolutionaries': 72, 'Penn State Nittany Lions': 64,
  'Indiana Hoosiers': 62, 'Iowa Hawkeyes': 60, 'Minnesota Golden Gophers': 62, 'Rutgers Scarlet Knights': 62, 'Clemson Tigers': 62, 'Georgia Bulldogs': 64, 'Virginia Tech Hokies': 60,
  'Texas A&M Aggies': 60, 'Pittsburgh Panthers': 62, 'Syracuse Orange': 62, 'Baylor Bears': 60, 'TCU Horned Frogs': 60, 'BYU Cougars': 64, 'Utah Utes': 58, 'Colorado Buffaloes': 58 };
// where international players come from (weights ~ real D-I rosters)
const COUNTRIES = [['Canada', 14], ['Australia', 12], ['Nigeria', 7], ['Serbia', 6], ['France', 6], ['Spain', 5], ['Germany', 5], ['Lithuania', 4], ['Senegal', 4], ['Finland', 3],
  ['Latvia', 3], ['Croatia', 3], ['Great Britain', 3], ['Turkey', 3], ['Greece', 3], ['Cameroon', 3], ['Italy', 3], ['Bahamas', 3], ['Montenegro', 2], ['Slovenia', 2],
  ['Brazil', 2], ['New Zealand', 2], ['Mali', 2], ['Netherlands', 2], ['Sweden', 2], ['Denmark', 1], ['Israel', 1], ['Japan', 1], ['Puerto Rico', 2], ['Dominican Republic', 1]];

/** schools: admissions bar + international access (new leagues; older saves on load) */
export function initSchools(state, geo) {
  const rng = makeRng(hashSeed(`${state.seed}:schools`));
  for (const t of Object.values(state.teams)) {
    if (t.acad == null) t.acad = ELITE.includes(t.name) ? (/Army|Navy|Air Force/.test(t.name) ? 93 : 95 + rng.int(4)) : HIGH[t.name] || Math.round(clamp(38 + (t.prestige || 30) * 0.12 + rng.normal(0, 7), 25, 62));
    if (t.intl == null) { const g = geo && geo[t.name]; t.intl = g ? g.intl : 0.3; t.hub = g ? g.hub : null; t.hubMi = g ? g.hubMi : null; t.cityPop = g ? g.pop : null; }
  }
}
/** players: durability + academics (+ countries for international players) */
export function initPeople(state) {
  const rng = makeRng(hashSeed(`${state.seed}:people:${state.year}`));
  for (const p of Object.values(state.players)) personalize(state, p, rng, false);
}
export function personalize(state, p, rng, recruit) {
  if (p.prone == null) {
    let x = Math.exp(rng.normal(0, 0.33)) * (/C/.test(p.pos || '') ? 1.1 : 1);
    if (!recruit && (p.injured || (p.gp != null && p.gp < 20))) x *= 1.6;          // missed real time last season
    p.prone = Math.round(clamp(x, 0.45, 2.5) * 100) / 100;
  }
  if (p.acad == null) {
    const t = p.team && state.teams[p.team];
    p.acad = Math.round(clamp(rng.normal(recruit ? 55 : 57, 17) + (t ? (t.acad - 50) * 0.4 : 0), 5, 99));
    if (!recruit && t && p.acad < bar(t, false)) p.acad = Math.round(bar(t, false) + rng.int(12));   // on the roster = he got in
  }
  if (p.home === 'INTL' && !p.country) p.country = COUNTRIES[rng.pick(COUNTRIES.map(c => c[1]))][0];
  return p;
}

// ── durability ──
export const durability = p => Math.round(clamp(100 - ((p.prone ?? 1) - 0.45) / 2.05 * 100, 0, 100));
export const durTag = p => { const d = durability(p); return d >= 85 ? 'Iron man' : d >= 72 ? 'Durable' : d >= 55 ? 'Average' : d >= 38 ? 'Injury prone' : 'Fragile'; };
/** the durability your staff sees for a recruit: a better medical program reads it more accurately */
export function scoutDur(state, r) {
  const t = state.teams[state.user], med = t && t.fac ? t.fac.medical : 50;
  const rng = makeRng(hashSeed(`${state.seed}:dur:${r.id}`)), sd = clamp(22 - med / 5, 3, 18);
  return Math.round(clamp(durability(r) + rng.normal(0, sd), 0, 100));
}

// ── academics ──
export const acadGrade = a => (a >= 90 ? 'A+' : a >= 80 ? 'A' : a >= 70 ? 'B+' : a >= 60 ? 'B' : a >= 50 ? 'C+' : a >= 40 ? 'C' : a >= 30 ? 'D' : a >= NCAA_MIN ? 'D-' : 'F');
/** the academic profile a school needs from an athlete (freshman / transfer) */
function bar(t, transfer) {
  const a = t.acad ?? 45;
  return Math.max(NCAA_MIN, a - 38 + (transfer && a >= 85 ? 12 : transfer && a >= 75 ? 5 : 0));
}
export const admitBar = (state, team, transfer) => bar(state.teams[team], transfer);
/** chance a school admits him: 0 below the NCAA minimum; a soft edge around the school's bar */
export function admitP(state, team, p, transfer) {
  if ((p.acad ?? 60) < NCAA_MIN) return 0;
  const b = bar(state.teams[team], transfer);
  return 1 / (1 + Math.exp(-((p.acad ?? 60) - b) / 3));
}
/** the AI's rule (no gambling on admissions): clear the bar */
export const admissible = (state, team, p, transfer) => (p.acad ?? 60) >= NCAA_MIN && (p.acad ?? 60) >= bar(state.teams[team], transfer) - 1;
export const admitLabel = pr => (pr >= 0.9 ? 'Clear' : pr >= 0.5 ? 'Likely' : pr >= 0.15 ? 'Borderline' : pr > 0 ? 'Unlikely' : 'Ineligible');

// ── in-season: a weak student can lose his spring semester ──
export function academicCheck(state, d, news) {
  if (state.acadChecked === state.year || d < `${state.year}-01-08`) return;
  state.acadChecked = state.year;
  const rng = makeRng(hashSeed(`${state.seed}:${state.year}:acad`));
  for (const t of Object.values(state.teams)) for (const id of t.players) {
    const p = state.players[id]; if (!p || (p.acad ?? 60) >= 32) continue;
    if (!rng.chance((32 - p.acad) / 45)) continue;
    p.out = Math.max(p.out || 0, 99); p.inj = { type: 'academically ineligible (spring semester)', games: 99, d, acad: true };
    if (t.name === state.user) news(state, d, 'injury', `${p.name} is academically ineligible for the spring semester`, t.name, p);
  }
}
