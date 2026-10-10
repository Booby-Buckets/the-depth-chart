import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, makeRng, hashSeed } from '../rng.js?v=58';

test('same seed -> same sequence', () => {
  const a = mulberry32(42), b = mulberry32(42);
  for (let i = 0; i < 1000; i++) assert.equal(a(), b());
});

test('different seeds diverge', () => {
  const a = mulberry32(1), b = mulberry32(2);
  let same = 0; for (let i = 0; i < 100; i++) if (a() === b()) same++;
  assert.ok(same < 2);
});

test('uniform in [0,1) with mean ~0.5', () => {
  const r = mulberry32(7); let s = 0, lo = 1, hi = 0;
  for (let i = 0; i < 100000; i++) { const x = r(); s += x; lo = Math.min(lo, x); hi = Math.max(hi, x); }
  assert.ok(lo >= 0 && hi < 1);
  assert.ok(Math.abs(s / 100000 - 0.5) < 0.01);
});

test('string seeds are stable', () => {
  assert.equal(hashSeed('2027:duke'), hashSeed('2027:duke'));
  assert.notEqual(hashSeed('2027:duke'), hashSeed('2027:unc'));
  assert.equal(makeRng('x').next(), makeRng('x').next());
});

test('normal has mean 0, sd 1', () => {
  const r = makeRng(3); let s = 0, s2 = 0; const n = 50000;
  for (let i = 0; i < n; i++) { const x = r.normal(); s += x; s2 += x * x; }
  assert.ok(Math.abs(s / n) < 0.02);
  assert.ok(Math.abs(Math.sqrt(s2 / n) - 1) < 0.02);
});

test('pick is proportional to weight', () => {
  const r = makeRng(9); const c = [0, 0, 0];
  for (let i = 0; i < 60000; i++) c[r.pick([1, 2, 3])]++;
  assert.ok(Math.abs(c[0] / 60000 - 1 / 6) < 0.01);
  assert.ok(Math.abs(c[2] / 60000 - 3 / 6) < 0.01);
});
