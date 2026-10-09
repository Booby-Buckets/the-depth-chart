// Load helpers shared by tools and (later) the browser: index the snapshot and prepare every team.
// The caller supplies the parsed JSON — this module never fetches (engine rule: no DOM / no Supabase).
import { attributes, prepareTeam, leagueRefs } from './ratings.js?v=16';

export function indexSnapshot(snap, C) {
  const byId = {};
  for (const p of snap.players) { p.attr = attributes(p, snap); byId[p.id] = p; }
  const L = leagueRefs(snap, byId);
  const teams = {};
  for (const t of snap.teams) teams[t.name] = prepareTeam(t, byId, snap, C);
  return { byId, L, teams };
}
