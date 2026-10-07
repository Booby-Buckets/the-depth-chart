// Tunable sim constants. tools/calibrate.js prints league averages vs engine/targets.json; tune here and
// log each round in engine/CALIBRATION.md. Multipliers act on the player's own rate; *_K terms are logit
// shifts per 1 SD of the relevant pillar (or per 10 points of conference strength for LEVEL_*).
export const C = {
  // pace: possessions per team = tempoA * tempoB / LG_PACE, +/- noise
  LG_PACE: 69.23,
  PACE_SD: 2.5,
  POSS_SCALE: 0.975,    // team tempos are box-score ESTIMATES (FGA-ORB+TOV+.475FTA), which run ~2.5% above real trips

  // who uses the possession: weight = use40 ^ USE_POW among the five on the floor
  USE_POW: 1.6,

  // turnovers
  TOV_MULT: 0.93,        // x player's turnovers per possession used
  DEF_TOV_K: 0.25,      // + logit per 1 SD of the defense's DEF pillar
  STL_SHARE: 0.60,      // share of turnovers that are steals at league-average steal rates

  // shot selection + free throws
  R3_MULT: 0.915,         // x player's 3PA/FGA
  AND1: 0.07,           // made FGs that draw an and-one
  FTR_MULT: 0.85,        // x player's FTA/FGA

  // makes
  P2_MULT: 0.985,
  P3_MULT: 0.925,
  FT_MULT: 1.0,
  DEF_PTS_K: 0.03,     // - logit on the shooter per DRtg point the five on the floor save (ratings def100)
  SYS_DEF_W: 1.0,       // weight on the team's system defense (snapshot sysDef, DRtg points per 100)
  BLK_RATE: 0.2,       // share of missed 2s that are blocked at league-average block rates
  HCA_K: 0.12,          // + logit on the home side's shots (not on neutral floors)

  // the schedule baked into a player's rates: offense and defense both scale with conference strength
  LEVEL_OFF_K: 0.037,    // + logit on the team's own makes per 10 pts of league net (strong league -> better)
  LEVEL_DEF_K: 0.043,    // - logit on opponents' makes per 10 pts of league net

  // rebounds: P(off reb) = O / (O + LAMBDA * D), O/D = summed oreb40 / dreb40 on the floor
  OREB_LAMBDA: 1.0,     // set by calibration so league ORB% hits target
  FT_OREB_F: 0.45,
  TEAM_REB: 0.075,      // rebounds credited to the team, not a player (deadballs, out of bounds)      // a missed last free throw is offensive-rebounded this x as often

  // assists: P(assisted | make) = base(type) * (teammates' ast40 sum / league 4-man sum)
  AST_BASE2: 0.43,
  AST_BASE3: 0.80,

  // game state: a team ahead coasts / goes to the bench, a team behind presses — margins pull back toward the
  // line (real game-to-game spread ~11 vs ~13 for independent possessions). logit per 10 points of lead.
  LEAD_K: 0.2,
  LEAD_FREE: 10,        // only the part of a lead beyond this many points counts

  // fouls with no free throws (reach-ins, offensive fouls are inside TOV)
  NS_FOUL: 0.07,
  FOUL_OUT: 5,

  // substitutions: re-pick the five every SUB_EVERY seconds by minutes still owed
  SUB_EVERY: 150,
  OT_SEC: 300,
};
