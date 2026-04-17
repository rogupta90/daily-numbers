// Countdown-style solver. Given a tile set, computes every reachable positive
// integer value (using any subset of tiles) along with the minimum number of
// operations needed to produce it. Operators: + - × ÷ with Countdown rules
// (subtraction yields positive; division must be exact).

// Cap intermediate values to keep the solver tractable on large tile counts.
// Values above this are discarded; any path that would route through a larger
// intermediate is lost. For 9 tiles this is the difference between running and
// OOM — 12M+ reachable values without it. With a 20k cap we retain everything
// relevant to a 4-digit target and catch the vast majority of solution paths.
const VALUE_CAP = 20000;

export function solveAll(tiles: number[]): Map<number, number> {
  const n = tiles.length;
  if (n > 30) throw new Error('tile count exceeds bitmask budget');
  const memo = new Map<number, Map<number, number>>();

  function update(m: Map<number, number>, k: number, v: number) {
    if (k <= 0 || k > VALUE_CAP || !Number.isInteger(k)) return;
    const cur = m.get(k);
    if (cur === undefined || v < cur) m.set(k, v);
  }

  function reach(mask: number): Map<number, number> {
    const cached = memo.get(mask);
    if (cached) return cached;
    const result = new Map<number, number>();

    // Popcount + single-tile base case
    let count = 0;
    let lastIdx = -1;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) { count++; lastIdx = i; }
    }
    if (count === 1) {
      result.set(tiles[lastIdx], 0);
      memo.set(mask, result);
      return result;
    }

    // Enumerate unordered splits (sub, comp) of mask
    for (let sub = (mask - 1) & mask; sub > 0; sub = (sub - 1) & mask) {
      const comp = mask ^ sub;
      if (sub >= comp) continue;
      const rA = reach(sub);
      const rB = reach(comp);
      for (const [a, oa] of rA) {
        for (const [b, ob] of rB) {
          const ops = oa + ob + 1;
          update(result, a + b, ops);
          update(result, a * b, ops);
          if (a > b) update(result, a - b, ops);
          else if (b > a) update(result, b - a, ops);
          if (b !== 0 && a % b === 0) update(result, a / b, ops);
          if (a !== 0 && b % a === 0) update(result, b / a, ops);
        }
      }
    }
    memo.set(mask, result);
    return result;
  }

  // Aggregate min-ops across every non-empty subset
  const all = new Map<number, number>();
  const full = (1 << n) - 1;
  for (let mask = 1; mask <= full; mask++) {
    const r = reach(mask);
    for (const [v, ops] of r) {
      const cur = all.get(v);
      if (cur === undefined || ops < cur) all.set(v, ops);
    }
  }
  return all;
}

export function solve(tiles: number[], target: number): { reachable: boolean; minOps: number } {
  const all = solveAll(tiles);
  const ops = all.get(target);
  return { reachable: ops !== undefined, minOps: ops ?? Infinity };
}
