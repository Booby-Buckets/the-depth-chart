import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { C } from '../constants.js?v=40';
import { createLeague, hydrate, dehydrate } from '../league.js?v=40';
import { overall } from '../ratings.js?v=40';
import { simTo } from '../flow.js?v=40';
import * as O from '../offseason.js?v=40';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const R = f => JSON.parse(fs.readFileSync(path.resolve(HERE, '../../../..', f)));
const snap = R('data/dynasty-snapshot.json'), sched = R('scripts/data/schedule_2027.json');

test('a season runs to a champion; a save round-trips', () => {
  const st = hydrate(createLeague(snap, sched, { user: 'Duke Blue Devils', seed: 7 }));
  simTo(st, C, {}, s => s.phase === 'done');
  assert.equal(st.phase, 'done');
  assert.ok(st.post.ncaa.champ);
  assert.equal(st.post.ncaa.autoBids.length + st.post.ncaa.atLarge.length, 68);
  const back = hydrate(JSON.parse(dehydrate(st)));
  assert.equal(back.post.ncaa.champ, st.post.ncaa.champ);
});

test('offseason: rosters land at 13, recruits by star band, players develop, a new schedule exists', () => {
  const st = hydrate(createLeague(snap, sched, { user: 'Duke Blue Devils', seed: 8 }));
  simTo(st, C, {}, s => s.phase === 'done');
  O.beginOffseason(st);
  assert.equal(st.phase, 'offseason');
  O.processDepartures(st); O.resolvePortal(st);
  const five = st.off.recruits.filter(r => r.stars === 5).map(r => overall(r, st.maps));
  assert.ok(Math.min(...five) > 70 && Math.max(...five) < 82, `5-star range ${Math.min(...five)}-${Math.max(...five)}`);
  O.resolveRecruiting(st);
  for (const t of Object.values(st.teams)) assert.ok(t.players.length >= 13, `${t.name} has ${t.players.length}`);
  O.startNextSeason(st);
  assert.equal(st.phase, 'regular'); assert.equal(st.year, 2028);
  assert.ok(st.schedule.length > 4000);
  const per = {}; for (const g of st.schedule) { per[g.h] = (per[g.h] || 0) + 1; per[g.a] = (per[g.a] || 0) + 1; }
  const counts = Object.values(per); assert.ok(Math.min(...counts) >= 20 && Math.max(...counts) <= 34, `games per team ${Math.min(...counts)}-${Math.max(...counts)}`);
  for (const t of Object.values(st.teams)) assert.ok(Math.abs(t.players.reduce((s, id) => s + st.players[id].mpg, 0) - 200) < 2);
});
