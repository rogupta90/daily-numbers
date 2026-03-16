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

  // 1 large number
  const largeNumbers = [25, 50, 75, 100];
  const large = largeNumbers[Math.floor(rand() * largeNumbers.length)];

  // 5 small numbers (1-10, can repeat)
  const smalls: number[] = [];
  for (let i = 0; i < 5; i++) {
    smalls.push(Math.floor(rand() * 10) + 1);
  }

  const numbers = [large, ...smalls];

  // Target: 100-999
  const target = Math.floor(rand() * 900) + 100;

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

  const lines = [
    `Daily Numbers #${result.dayNumber}`,
    `${result.target} → ${result.answer ?? '—'} [${result.score === 0 ? 'EXACT' : `${result.score} off`}]`,
  ];
  if (stats.currentStreak > 1) {
    lines.push(`Streak: ${stats.currentStreak}`);
  }
  lines.push('', 'dailynumbers.game'); // placeholder URL
  return lines.join('\n');
}
