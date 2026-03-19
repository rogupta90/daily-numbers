// Seeded random number generator (deterministic from date)
function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function dateSeed(date: Date): number {
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  return y * 10000 + m * 100 + d;
}

export function getDayNumber(): number {
  const launch = new Date(2026, 2, 16); // March 16, 2026
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  launch.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - launch.getTime()) / 86400000) + 1;
}

export interface Puzzle {
  target: number;
  numbers: number[];
  dayNumber: number;
}

export function generatePuzzle(date: Date = new Date()): Puzzle {
  const rand = seededRandom(dateSeed(date));
  const dayNumber = getDayNumber();

  // 3 large numbers (no repeats)
  const largePool = [25, 50, 75, 100];
  const shuffled = [...largePool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const larges = shuffled.slice(0, 3);

  // 6 small numbers (1-10, can repeat)
  const smalls: number[] = [];
  for (let i = 0; i < 6; i++) {
    smalls.push(Math.floor(rand() * 10) + 1);
  }

  const numbers = [...larges, ...smalls];

  // Target: 1000-9999 (high targets, not always solvable)
  const target = Math.floor(rand() * 9000) + 1000;

  return { target, numbers, dayNumber };
}

// Evaluate a postfix expression built from user taps
export type Token = { type: 'number'; value: number; id: number } | { type: 'op'; value: string };

export function evaluateExpression(tokens: Token[]): number | null {
  // Convert infix token list to a value
  // Simple left-to-right evaluation respecting operator precedence
  if (tokens.length === 0) return null;

  // Must start and end with numbers, alternating num/op/num
  const nums: number[] = [];
  const ops: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (i % 2 === 0) {
      if (t.type !== 'number') return null;
      nums.push(t.value);
    } else {
      if (t.type !== 'op') return null;
      ops.push(t.value);
    }
  }

  // Last token must be a number
  if (tokens[tokens.length - 1].type !== 'number') return null;

  // Evaluate with precedence: first * and /, then + and -
  // Pass 1: handle * and /
  const reducedNums: number[] = [nums[0]];
  const reducedOps: string[] = [];

  for (let i = 0; i < ops.length; i++) {
    if (ops[i] === '×' || ops[i] === '÷') {
      const left = reducedNums.pop()!;
      const right = nums[i + 1];
      if (ops[i] === '÷') {
        if (right === 0) return null;
        if (left % right !== 0) return null; // Must be whole number
        reducedNums.push(left / right);
      } else {
        reducedNums.push(left * right);
      }
    } else {
      reducedOps.push(ops[i]);
      reducedNums.push(nums[i + 1]);
    }
  }

  // Pass 2: handle + and -
  let result = reducedNums[0];
  for (let i = 0; i < reducedOps.length; i++) {
    if (reducedOps[i] === '+') {
      result += reducedNums[i + 1];
    } else {
      result -= reducedNums[i + 1];
    }
  }

  return result;
}

export function expressionToString(tokens: Token[]): string {
  return tokens.map(t => t.type === 'number' ? t.value.toString() : ` ${t.value} `).join('');
}

// Score: 0 = perfect, higher = worse
export function getScore(target: number, answer: number | null): number {
  if (answer === null) return target; // didn't answer
  return Math.abs(target - answer);
}

export function getScoreLabel(score: number): string {
  if (score === 0) return 'Exact';
  if (score <= 5) return 'Close';
  if (score <= 10) return 'Near';
  if (score <= 25) return 'Fair';
  return 'Off';
}


// History / persistence
export interface GameResult {
  dayNumber: number;
  date: string; // ISO date string
  target: number;
  answer: number | null;
  score: number;
  expression: string;
  numbersPerStep?: number[];
  stepResults?: number[];
}

export interface Stats {
  played: number;
  perfectCount: number;
  bestScore: number;
  averageScore: number;
  currentStreak: number;
  maxStreak: number;
}

const HISTORY_KEY = 'countdown_history';

export function getHistory(): GameResult[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveResult(result: GameResult): void {
  const history = getHistory();
  // Don't save duplicate days
  if (history.some(r => r.dayNumber === result.dayNumber)) return;
  history.push(result);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

export function hasPlayedToday(): boolean {
  const history = getHistory();
  const dayNumber = getDayNumber();
  return history.some(r => r.dayNumber === dayNumber);
}

export function getTodayResult(): GameResult | undefined {
  const history = getHistory();
  const dayNumber = getDayNumber();
  return history.find(r => r.dayNumber === dayNumber);
}

export function getStats(): Stats {
  const history = getHistory();
  if (history.length === 0) {
    return { played: 0, perfectCount: 0, bestScore: Infinity, averageScore: 0, currentStreak: 0, maxStreak: 0 };
  }

  const scores = history.map(r => r.score);
  const played = history.length;
  const perfectCount = scores.filter(s => s === 0).length;
  const bestScore = Math.min(...scores);
  const averageScore = Math.round(scores.reduce((a, b) => a + b, 0) / played * 10) / 10;

  // Streak: consecutive days played (not necessarily perfect)
  const sorted = [...history].sort((a, b) => b.dayNumber - a.dayNumber);
  let currentStreak = 0;
  const todayNum = getDayNumber();
  let expected = hasPlayedToday() ? todayNum : todayNum - 1;

  for (const r of sorted) {
    if (r.dayNumber === expected) {
      currentStreak++;
      expected--;
    } else {
      break;
    }
  }

  let maxStreak = 0;
  let streak = 1;
  const sortedAsc = [...history].sort((a, b) => a.dayNumber - b.dayNumber);
  for (let i = 1; i < sortedAsc.length; i++) {
    if (sortedAsc[i].dayNumber === sortedAsc[i - 1].dayNumber + 1) {
      streak++;
    } else {
      maxStreak = Math.max(maxStreak, streak);
      streak = 1;
    }
  }
  maxStreak = Math.max(maxStreak, streak);

  return { played, perfectCount, bestScore, averageScore, currentStreak, maxStreak };
}

export function getShareText(result: GameResult): string {
  const stats = getStats();
  const steps = result.numbersPerStep?.length ?? 0;

  const lines = [`Daily Numbers #${result.dayNumber}`];
  lines.push('');
  lines.push(`🎯 ${result.target}`);

  if (result.score === 0) {
    lines.push(`✅ Exact${steps ? ` in ${steps} step${steps > 1 ? 's' : ''}` : ''}`);
  } else {
    lines.push(`📐 ${result.score} away (${result.answer ?? '—'})`);
  }

  if (stats.currentStreak > 1) {
    lines.push(`🔥 ${stats.currentStreak} streak`);
  }

  lines.push('');
  lines.push('dailynumbers.game');
  return lines.join('\n');
}

export function getScoreDistribution(): { label: string; count: number; color: string; dimColor: string }[] {
  const history = getHistory();
  const dist = [
    { label: 'Exact', count: 0, color: 'var(--accent)', dimColor: 'var(--accent-dim)' },
    { label: 'Close', count: 0, color: 'var(--accent)', dimColor: 'var(--accent-dim)' },
    { label: 'Near', count: 0, color: 'var(--amber)', dimColor: 'var(--amber-dim)' },
    { label: 'Fair', count: 0, color: 'var(--amber)', dimColor: 'var(--amber-dim)' },
    { label: 'Off', count: 0, color: 'var(--red)', dimColor: 'var(--red-dim)' },
  ];
  for (const r of history) {
    if (r.score === 0) dist[0].count++;
    else if (r.score <= 5) dist[1].count++;
    else if (r.score <= 10) dist[2].count++;
    else if (r.score <= 25) dist[3].count++;
    else dist[4].count++;
  }
  return dist;
}
