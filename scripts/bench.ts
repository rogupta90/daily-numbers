import { solveAll } from '../src/solver.ts';

const samples = [
  [100, 75, 50, 3, 7, 2, 5, 8, 4],
  [25, 75, 100, 1, 2, 3, 4, 5, 6],
  [50, 75, 100, 9, 8, 7, 10, 6, 4],
];

for (const tiles of samples) {
  const t = Date.now();
  const r = solveAll(tiles);
  console.log(`tiles=${tiles.join(',')}  time=${Date.now() - t}ms  reach=${r.size}`);
}
