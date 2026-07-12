/**
 * grade_v4_run.mjs — adapter: feed OUR bbref data into the new pillar engine
 * (player-grades.mjs) and calibrate against the hand-ranked Virginia roster.
 *
 *   node grade_v4_run.mjs [season]      # default season 2026 (=2025-26)
 *
 * No DB writes — calibration/inspection only.
 */
import { readFileSync } from 'node:fs';
import { gradePlayers, CONFIG } from './player-grades.mjs';
import { runCalibration } from './calibrate-grades.mjs';

const SEASON = +(process.argv[2] || 2026);
const MIN_MPG = 8, MIN_G = 5;

const f = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(+v) ? +v : null));
function htIn(h){ const m=String(h||'').match(/^(\d)-(\d{1,2})$/); return m?(+m[1]*12+ +m[2]):null; }
function posGroup(pos){ const p=String(pos||'').toUpperCase().split(/[-\/]/)[0];
  if(['PG','SG','G','CG'].includes(p)) return 'G';
  if(['C','PF','FC'].includes(p)) return 'B';
  return 'W'; }

// ── load our data, map to the engine's stat keys ──
const rows = [];
for (const line of readFileSync('data/bbref.jsonl','utf8').split('\n')) {
  if (!line.trim()) continue;
  let b; try { b = JSON.parse(line); } catch { continue; }
  if (b.season !== SEASON) continue;
  const pg=b.pergame||{}, adv=b.advanced||{}, p4=b.per40||{};
  const mpg=f(pg.mp_per_g), games=f(pg.games);
  if (mpg===null || mpg<MIN_MPG || (games!==null && games<MIN_G)) continue;
  const ws=f(adv.ws), mp=f(adv.mp);
  rows.push({
    name:b.player, team:b.school, pos:b.pos, _grp:posGroup(b.pos),
    gamesPlayed:games, mpg,
    height:htIn(b.height),   // heightVsPos filled after we know group means
    // offense
    ppg:f(pg.pts_per_g), fta:f(pg.fta_per_g), ppg40:f(p4.pts_per_min), obpm:f(adv.obpm), ows:f(adv.ows),
    // efficiency
    tsPct:f(adv.ts_pct), tpPct:f(pg.fg3_pct), fgPct:f(pg.fg_pct), ftPct:f(pg.ft_pct),
    // creation
    ast:f(pg.ast_per_g), astPct:f(adv.ast_pct), pprod:f(adv.pprod), orb:f(pg.orb_per_g),
    to:f(pg.tov_per_g), tovPct:f(adv.tov_pct),
    // usage
    usgPct:f(adv.usg_pct), per:f(adv.per), apg40:f(p4.ast_per_min),
    // impact (glsT1-4 not available yet -> null, engine skips)
    wa: ws!==null ? +(ws-0.04*((mp||0)/40)).toFixed(3) : null, ws, bpm:f(adv.bpm),
    glsT1:null, glsT2:null, glsT3:null, glsT4:null,
    // defense
    stl:f(pg.stl_per_g), blk:f(pg.blk_per_g), drb:f(pg.drb_per_g), pf:f(pg.pf_per_g),
    // scalability (per-40)
    fga40:f(p4.fga_per_min), fta40:f(p4.fta_per_min), pf40:f(p4.pf_per_min), to40:f(p4.tov_per_min),
  });
}
// heightVsPos = height minus the mean height of the player's position group
const gm={}, gc={};
for(const r of rows){ if(r.height!=null){ gm[r._grp]=(gm[r._grp]||0)+r.height; gc[r._grp]=(gc[r._grp]||0)+1; } }
for(const k in gm) gm[k]/=gc[k];
for(const r of rows) r.heightVsPos = (r.height!=null && gm[r._grp]!=null) ? r.height-gm[r._grp] : null;

console.log(`pool: ${rows.length} qualified players in ${SEASON-1}-${String(SEASON).slice(2)} (mpg>=${MIN_MPG}, g>=${MIN_G})`);
console.log(`mode=${CONFIG.mode} standardize=${CONFIG.standardize} | k=${CONFIG.logistic.k} center=${CONFIG.logistic.center}`);

const graded = gradePlayers(rows);
const byName = Object.fromEntries(graded.map(p=>[p.name, p]));

// ── the hand-ranked Virginia roster (user's target) ──
const TARGET = {'Chance Mallory':83,'Jurian Dixon':79,'Sam Lewis':82,'Thijs De Ridder':92,
  'Johann Grunloh':83,'Jan Vide':78,'Christian Harmon':77,'Kalu Anya':71,'Elijah Gertrude':70,
  'Martin Carrere':69,'Favour Ibe':70,'Silas Barksdale':68,'Carter Lang':66};
console.log('\n=== VIRGINIA — engine grade vs your ranking ===');
console.log(' PLAYER                ENGINE  YOURS   GAP');
let gaps=[];
for(const [n,t] of Object.entries(TARGET).sort((a,b)=>b[1]-a[1])){
  const p=byName[n];
  if(p){ const g=p.grade-t; gaps.push(g);
    console.log(`  ${n.padEnd(20)} ${String(p.grade).padStart(5)} ${String(t).padStart(6)} ${(g>=0?'+':'')+g}`.padEnd(40)); }
  else console.log(`  ${n.padEnd(20)} ${'—'.padStart(5)} ${String(t).padStart(6)}   (no ${SEASON-1}-${String(SEASON).slice(2)} season)`);
}
if(gaps.length){ const mean=gaps.reduce((a,b)=>a+b,0)/gaps.length;
  console.log(`\n  matched ${gaps.length} | avg gap ${mean>=0?'+':''}${mean.toFixed(1)} | MAE ${(gaps.reduce((a,b)=>a+Math.abs(b),0)/gaps.length).toFixed(1)}`); }

runCalibration(graded, { sweep:true });
