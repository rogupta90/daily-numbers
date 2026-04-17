import { writeFileSync } from 'node:fs';
import { solveAll } from '../src/solver.ts';

// Generates a deterministic, pre-validated puzzle bank.
// Criteria per puzzle:
//   - target in [1000, 9999] (matches the game's current range)
//   - minOps in [MIN_OPS, MAX_OPS] (not trivial, not punishingly deep)
//   - exact solution guaranteed to exist

const NUM_DAYS = 500;
// Classic Countdown: 6 tiles → max 5 ops. minOps 4–5 uses ≥5 tiles.
const MIN_OPS = 4;
const MAX_OPS = 5;
// Classic Countdown target range (100–999). Tighter than the old 4-digit range
// so that a meaningful fraction of tile sets actually reaches the target.
const TARGET_MIN = 100;
const TARGET_MAX = 999;
const LARGE_POOL = [25, 50, 75, 100];

function seededRandom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function pickTiles(rand: () => number): number[] {
  // Classic Countdown: 6 tiles. Large count varies 1–3 for variety.
  const largeCount = 1 + Math.floor(rand() * 3);
  const smallCount = 6 - largeCount;
  const large = [...LARGE_POOL];
  for (let i = large.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [large[i], large[j]] = [large[j], large[i]];
  }
  const smalls: number[] = [];
  for (let i = 0; i < smallCount; i++) smalls.push(Math.floor(rand() * 10) + 1);
  return [...large.slice(0, largeCount), ...smalls];
}

interface PuzzleEntry {
  day: number;
  numbers: number[];
  target: number;
  minOps: number;
}

const puzzles: PuzzleEntry[] = [];
const start = Date.now();

for (let day = 1; day <= NUM_DAYS; day++) {
  let attempt = 0;
  while (true) {
    attempt++;
    const rand = seededRandom(day * 100003 + attempt);
    const tiles = pickTiles(rand);

    const all = solveAll(tiles);
    const candidates: { v: number; ops: number }[] = [];
    for (const [v, ops] of all) {
      if (v >= TARGET_MIN && v <= TARGET_MAX && ops >= MIN_OPS && ops <= MAX_OPS) {
        candidates.push({ v, ops });
      }
    }

    if (candidates.length === 0) continue;

    // Prefer the deeper candidates so the puzzle actually requires work
    candidates.sort((a, b) => b.ops - a.ops);
    const topBand = candidates.filter(c => c.ops === candidates[0].ops);
    const pick = topBand[Math.floor(rand() * topBand.length)];

    puzzles.push({ day, numbers: tiles, target: pick.v, minOps: pick.ops });
    break;
  }

  if (day % 25 === 0) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  day ${day}/${NUM_DAYS}  (${elapsed}s)`);
  }
}

const opsHistogram: Record<number, number> = {};
for (const p of puzzles) opsHistogram[p.minOps] = (opsHistogram[p.minOps] || 0) + 1;

const out = {
  generatedAt: new Date().toISOString(),
  count: puzzles.length,
  criteria: { minOps: MIN_OPS, maxOps: MAX_OPS, targetMin: TARGET_MIN, targetMax: TARGET_MAX },
  puzzles,
};

writeFileSync(new URL('../src/puzzles.json', import.meta.url), JSON.stringify(out, null, 2));

console.log(`\nwrote ${puzzles.length} puzzles to src/puzzles.json`);
console.log('minOps distribution:', opsHistogram);
console.log(`total time: ${((Date.now() - start) / 1000).toFixed(1)}s`);
