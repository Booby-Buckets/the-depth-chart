import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { C } from '../constants.js?v=57';
import { createLeague, hydrate, dehydrate } from '../league.js?v=57';
import { overall } from '../ratings.js?v=57';
import { simTo } from '../flow.js?v=57';
import * as O from '../offseason.js?v=57';
import { rosterMax } from '../commits.js?v=57';

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

test('offseason: rosters fill to 16 (service academies 20), recruits by star band, players develop, a new schedule exists', () => {
  const st = hydrate(createLeague(snap, sched, { user: 'Duke Blue Devils', seed: 8 }));
  simTo(st, C, {}, s => s.phase === 'done');
  O.beginOffseason(st);
  assert.equal(st.phase, 'offseason');
  O.processDepartures(st); O.resolvePortal(st);
  const five = st.off.recruits.filter(r => r.stars === 5).map(r => overall(r, st.maps));
  assert.ok(Math.min(...five) > 70 && Math.max(...five) < 82, `5-star range ${Math.min(...five)}-${Math.max(...five)}`);
  O.resolveRecruiting(st);
  for (const t of Object.values(st.teams)) assert.ok(t.players.length >= rosterMax(st, t.name), `${t.name} has ${t.players.length}`);
  O.startNextSeason(st);
  assert.equal(st.phase, 'regular'); assert.equal(st.year, 2028);
  assert.ok(st.schedule.length > 4000);
  const per = {}; for (const g of st.schedule) for (const t of [g.h, g.a]) if (st.teams[t]) per[t] = (per[t] || 0) + 1;   // D-I programs (non-D-I opponents play once)
  const counts = Object.values(per); assert.ok(Math.min(...counts) >= 20 && Math.max(...counts) <= 34, `games per team ${Math.min(...counts)}-${Math.max(...counts)}`);
  for (const t of Object.values(st.teams)) assert.ok(Math.abs(t.players.reduce((s, id) => s + st.players[id].mpg, 0) - 200) < 2);
});

test('recruiting race: offers, cuts, commits, flips stay sane over a season', () => {
  const st = hydrate(createLeague(snap, sched, { user: 'Duke Blue Devils', seed: 9 }));
  const R = st.rclass;
  assert.ok(R.every(r => Array.isArray(r.list)), 'every recruit has a list');
  const five = R.filter(r => r.stars === 5);
  assert.ok(five.reduce((s, r) => s + r.list.length, 0) / five.length >= 5, 'five-stars hear from several programs');
  simTo(st, C, {}, s => s.phase === 'done');
  const done = R.filter(r => r.commit || r.signed).length, offered = R.filter(r => r.list.length).length;
  assert.ok(done / offered > 0.6, `most offered recruits commit by spring (${done}/${offered})`);
  assert.ok(R.filter(r => r.signed).length > 50, 'an early signing period happened');
  for (const r of R) if (r.commit) assert.ok(r.list.includes(r.commit), 'a commit school is on his list');
  for (const r of R.filter(r => r.stage === 't3')) assert.ok(r.list.length <= 3);
});
