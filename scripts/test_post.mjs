#!/usr/bin/env node
// Run one Social Studio "Posts" source (js/posts/<key>.js) in node and print what it returns — the same helpers (H) the
// page hands it, built from the repo's files + the public Supabase tables. For developing post sources without a browser.
//   node scripts/test_post.mjs <key> [json-of-d]      e.g.  node scripts/test_post.mjs continuity '{"n":5,"conf":"ACC"}'
// Not available here (browser-only): TDCProjGrade (lineOf / gradeSolo return null), the season simulators.
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm'; import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SB = 'https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1', KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
const key = process.argv[2]; const d = Object.assign({ n: 10, team: '', conf: '', season: '2026' }, JSON.parse(process.argv[3] || '{}'));
if (!key) { console.error('usage: node scripts/test_post.mjs <key> [json]'); process.exit(1); }
const ctx = { window: {}, console, fetch, setTimeout, Promise, Math, JSON, Date };
ctx.window = ctx; vm.createContext(ctx);
for (const f of ['team-colors.js', 'social-posts.js', `js/posts/${key}.js`]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
const get = async q => { for (let t = 0; t < 4; t++) { try { const r = await fetch(`${SB}/${q}`, { headers: { apikey: KEY }, signal: AbortSignal.timeout(90000) }); if (r.ok) return r.json(); } catch (e) {} await new Promise(r => setTimeout(r, 2000 * (t + 1))); } throw new Error('supabase: ' + q); };
let RS = null, PL = null;
const CONF = { 'BIG-12': 'Big 12', 'B10': 'Big Ten', 'PAC-12': 'Pac-12', 'Big-East': 'Big East', 'A10': 'A-10', 'MWC': 'Mountain West', 'Mountain West Conference': 'Mountain West' };
const school = t => { try { return (ctx.tdcShortSchool && ctx.tdcShortSchool(t)) || t; } catch (e) { return t; } };
const tkey = t => String(school(t) || t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const confName = c => { c = c || ''; return CONF[c] || c.replace(/ Conference$/, ''); };
const H = {
  SEASON: '2026-27',
  json: async p => JSON.parse(fs.readFileSync(path.join(ROOT, p.split('?')[0]), 'utf8')),
  ratings: async () => RS || (RS = ((await get('predictive_ratings?season=eq.2027&select=data&limit=1'))[0].data.teams)),
  players: async () => { if (PL) return PL; PL = []; for (let o = 0; ; o += 1000) { const r = await get(`players?select=*&order=id.asc&limit=1000&offset=${o}`); PL.push(...r); if (r.length < 1000) break; } return PL; },
  needScript: async () => { throw new Error('needScript is browser-only'); },
  school, tkey, confName,
  confOfFull: t => { const r = (RS || []).find(x => x.full === t || x.team === t) || (RS || []).find(x => tkey(x.team) === tkey(t)); return r ? confName(r.conf) : ''; },
  onTeam: (t, sel) => !sel || tkey(t) === tkey(sel),
  nowTeam: espn => { const p = (PL || []).find(x => String(x.espn_id) === String(espn)); return p ? p.team : null; },
  logoUrl: t => { const c = ctx.tdcTeamColor && ctx.tdcTeamColor(t); return (c && c.logo) || null; },
  lineOf: () => null, gradeSolo: () => null,
  fmt: (v, dec, plus) => { if (v == null || v === '' || !isFinite(+v)) return ''; const s = (+v).toFixed(dec == null ? 1 : dec); return (plus && +v > 0 ? '+' : '') + s; }
};
await H.ratings(); if (process.argv.includes('--players')) await H.players();
const P = ctx.TDC_POSTS.get(key); if (!P) { console.error('not registered: ' + key); process.exit(1); }
const r = await P.load(d, H);
console.log(JSON.stringify({ title: r.title, subtitle: r.subtitle, lead: r.lead, src: r.src, cols: r.cols, players: r.players, n: (r.rows || []).length }, null, 1));
for (const x of (r.rows || [])) console.log('  ' + [x.name, x.team, x.tag, x.val].concat((r.cols || []).map(c => c.k + '=' + x[c.k])).join(' | ') + (x.team && !H.logoUrl(x.team) ? '   [NO LOGO]' : ''));
