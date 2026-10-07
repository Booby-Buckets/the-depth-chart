// Seeded PRNG (mulberry32): the same seed always gives the same game.
// Pure — no Math.random, no DOM, no network (engine rule, see CLAUDE.md).

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// string -> 32-bit seed (FNV-1a), so seeds can be readable ("2027:duke:unc")
export function hashSeed(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// A small RNG object around one stream: uniform, normal, weighted pick, child streams.
export function makeRng(seed) {
  const next = mulberry32(typeof seed === 'string' ? hashSeed(seed) : seed);
  const rng = {
    next,
    chance: p => next() < p,
    int: n => Math.floor(next() * n),
    // Box–Muller
    normal(mu = 0, sd = 1) {
      let u = 0; while (u === 0) u = next();
      return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    },
    // index into weights (non-negative), proportional to weight
    pick(weights, total) {
      if (total == null) { total = 0; for (let i = 0; i < weights.length; i++) total += weights[i]; }
      let r = next() * total;
      for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r < 0) return i; }
      return weights.length - 1;
    },
    // an independent stream derived from this one (season -> game seeds)
    child: () => makeRng((next() * 4294967296) >>> 0),
  };
  return rng;
}
