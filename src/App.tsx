import { useState, useEffect, useCallback, useRef } from 'react';
import {
  generatePuzzle,
  evaluateExpression,
  expressionToString,
  getScore,
  getScoreLabel,
  saveResult,
  hasPlayedToday,
  getTodayResult,
  getStats,
  getShareText,
  getHistory,
  type Token,
  type Puzzle,
  type GameResult,
  type Stats,
} from './game';

interface Tile {
  id: number;
  value: number;
  derived: boolean;
}

interface Step {
  tokens: Token[];
  expression: string;
  result: number;
  consumedTileIds: number[];
  producedTileId: number;
}

type Screen = 'home' | 'playing' | 'result' | 'history';

let nextDerivedId = 100;

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [puzzle, setPuzzle] = useState<Puzzle>(() => generatePuzzle());
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [pendingTileIds, setPendingTileIds] = useState<Set<number>>(new Set());
  const [consumedTileIds, setConsumedTileIds] = useState<Set<number>>(new Set());
  const [bestAnswer, setBestAnswer] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(45);
  const [result, setResult] = useState<GameResult | null>(null);
  const [stats, setStats] = useState<Stats>(getStats());
  const [copied, setCopied] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finishedRef = useRef(false);

  useEffect(() => {
    if (hasPlayedToday()) {
      const todayResult = getTodayResult()!;
      setResult(todayResult);
      setScreen('result');
    }
  }, []);

  const expectingNumber = tokens.length === 0 || tokens[tokens.length - 1].type === 'op';
  const currentValue = evaluateExpression(tokens);
  const canEvaluate = !expectingNumber && tokens.length >= 3;
  const unavailableTileIds = new Set([...consumedTileIds, ...pendingTileIds]);

  const effectiveAnswer = (() => {
    const candidates: number[] = [];
    if (bestAnswer !== null) candidates.push(bestAnswer);
    if (currentValue !== null && !expectingNumber) candidates.push(currentValue);
    if (candidates.length === 0) return null;
    return candidates.reduce((best, c) =>
      Math.abs(c - puzzle.target) < Math.abs(best - puzzle.target) ? c : best
    );
  })();

  const startGame = useCallback(() => {
    const p = generatePuzzle();
    setPuzzle(p);
    nextDerivedId = 100;
    setTiles(p.numbers.map((v, i) => ({ id: i, value: v, derived: false })));
    setSteps([]);
    setTokens([]);
    setPendingTileIds(new Set());
    setConsumedTileIds(new Set());
    setBestAnswer(null);
    setTimeLeft(45);
    finishedRef.current = false;
    setScreen('playing');
  }, []);

  useEffect(() => {
    if (screen !== 'playing') return;
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [screen]);

  const handleFinish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    setFinishing(true);
  }, []);

  useEffect(() => {
    if (!finishing) return;
    setFinishing(false);

    const candidates: number[] = [];
    if (bestAnswer !== null) candidates.push(bestAnswer);
    if (currentValue !== null && !expectingNumber) candidates.push(currentValue);

    const answer = candidates.length > 0
      ? candidates.reduce((best, c) =>
          Math.abs(c - puzzle.target) < Math.abs(best - puzzle.target) ? c : best
        )
      : null;

    const score = getScore(puzzle.target, answer);

    const allExprs: string[] = [];
    for (const s of steps) {
      allExprs.push(`${s.expression} = ${s.result}`);
    }
    if (tokens.length > 0) {
      const expr = expressionToString(tokens);
      if (currentValue !== null && !expectingNumber) {
        allExprs.push(`${expr} = ${currentValue}`);
      } else {
        allExprs.push(expr);
      }
    }

    const gameResult: GameResult = {
      dayNumber: puzzle.dayNumber,
      date: new Date().toISOString().split('T')[0],
      target: puzzle.target,
      answer,
      score,
      expression: allExprs.join(' → ') || '(no answer)',
    };

    saveResult(gameResult);
    setResult(gameResult);
    setStats(getStats());
    setScreen('result');
  }, [finishing]);

  useEffect(() => {
    if (timeLeft === 0 && screen === 'playing') {
      handleFinish();
    }
  }, [timeLeft, screen]);

  const tapNumber = (tileId: number, value: number) => {
    if (!expectingNumber) return;
    if (unavailableTileIds.has(tileId)) return;
    setTokens(prev => [...prev, { type: 'number', value, id: tileId }]);
    setPendingTileIds(prev => new Set(prev).add(tileId));
  };

  const tapOp = (op: string) => {
    if (expectingNumber) return;
    if (tokens.length === 0) return;
    setTokens(prev => [...prev, { type: 'op', value: op }]);
  };

  const undo = () => {
    if (tokens.length > 0) {
      const last = tokens[tokens.length - 1];
      if (last.type === 'number') {
        setPendingTileIds(prev => {
          const next = new Set(prev);
          next.delete(last.id);
          return next;
        });
      }
      setTokens(prev => prev.slice(0, -1));
      return;
    }
    if (steps.length > 0) {
      const lastStep = steps[steps.length - 1];
      setTiles(prev => prev.filter(t => t.id !== lastStep.producedTileId));
      setConsumedTileIds(prev => {
        const next = new Set(prev);
        for (const id of lastStep.consumedTileIds) next.delete(id);
        return next;
      });
      setTokens(lastStep.tokens);
      setPendingTileIds(new Set(lastStep.consumedTileIds));
      setSteps(prev => prev.slice(0, -1));
      const remainingSteps = steps.slice(0, -1);
      if (remainingSteps.length === 0) {
        setBestAnswer(null);
      } else {
        const best = remainingSteps.reduce((b, s) =>
          Math.abs(s.result - puzzle.target) < Math.abs(b - puzzle.target) ? s.result : b
        , remainingSteps[0].result);
        setBestAnswer(best);
      }
    }
  };

  const clearExpression = () => {
    setPendingTileIds(new Set());
    setTokens([]);
  };

  const evaluate = () => {
    if (!canEvaluate || currentValue === null) return;
    const newTileId = nextDerivedId++;
    const newTile: Tile = { id: newTileId, value: currentValue, derived: true };
    const consumedIds = [...pendingTileIds];
    const step: Step = {
      tokens: [...tokens],
      expression: expressionToString(tokens),
      result: currentValue,
      consumedTileIds: consumedIds,
      producedTileId: newTileId,
    };
    const newBest = bestAnswer === null
      ? currentValue
      : Math.abs(currentValue - puzzle.target) < Math.abs(bestAnswer - puzzle.target)
        ? currentValue : bestAnswer;

    setTiles(prev => [...prev, newTile]);
    setSteps(prev => [...prev, step]);
    setConsumedTileIds(prev => {
      const next = new Set(prev);
      for (const id of consumedIds) next.add(id);
      return next;
    });
    setPendingTileIds(new Set());
    setTokens([]);
    setBestAnswer(newBest);
  };

  const share = async () => {
    if (!result) return;
    const text = getShareText(result);
    try {
      if (navigator.share) {
        await navigator.share({ text });
      } else {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch { /* ignore */ }
    }
  };

  // --- SCREENS ---

  if (screen === 'history') {
    return <HistoryScreen onBack={() => setScreen(result ? 'result' : 'home')} />;
  }

  if (screen === 'result' && result) {
    const label = getScoreLabel(result.score);
    const scoreColor = result.score === 0 ? 'var(--accent)' : result.score <= 10 ? 'var(--amber)' : 'var(--red)';

    return (
      <div className="flex flex-col items-center justify-center min-h-dvh px-4 py-8">
        {/* Score hero */}
        <div
          className="font-mono text-7xl font-extrabold mb-2"
          style={{ color: scoreColor }}
        >
          {result.score === 0 ? '0' : result.score}
        </div>
        <div className="text-sm font-medium uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>
          {result.score === 0 ? label : `${label} — ${result.score} off`}
        </div>
        <div className="text-xs mb-8" style={{ color: 'var(--text-dim)' }}>
          Daily Numbers #{result.dayNumber}
        </div>

        {/* Result card */}
        <div
          className="rounded-lg p-6 mb-6 w-full max-w-sm"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div className="flex justify-between items-start mb-5">
            <div>
              <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: 'var(--text-dim)' }}>Target</div>
              <div className="font-mono text-4xl font-bold">{result.target}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: 'var(--text-dim)' }}>Answer</div>
              <div className="font-mono text-4xl font-bold" style={{ color: result.score === 0 ? 'var(--accent)' : 'var(--text)' }}>
                {result.answer ?? '—'}
              </div>
            </div>
          </div>

          {result.score > 0 && (
            <div className="text-center py-2 rounded-md font-mono text-sm font-semibold"
              style={{
                background: result.score <= 10 ? 'var(--amber-dim)' : 'var(--red-dim)',
                color: result.score <= 10 ? 'var(--amber)' : 'var(--red)',
              }}
            >
              {result.score} away
            </div>
          )}
          {result.score === 0 && (
            <div className="text-center py-2 rounded-md font-mono text-sm font-semibold"
              style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
            >
              Exact match
            </div>
          )}

          <div className="mt-4 pt-4 text-xs font-mono" style={{ borderTop: '1px solid var(--border)', color: 'var(--text-dim)' }}>
            {result.expression}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 w-full max-w-sm mb-6">
          <StatBox label="Played" value={stats.played} />
          <StatBox label="Exact" value={stats.perfectCount} />
          <StatBox label="Streak" value={stats.currentStreak} />
        </div>

        {/* Actions */}
        <div className="flex gap-2 w-full max-w-sm">
          <button
            onClick={share}
            className="flex-1 py-3 rounded-lg text-sm font-semibold uppercase tracking-wider cursor-pointer"
            style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
          >
            {copied ? 'Copied' : 'Share'}
          </button>
          <button
            onClick={() => { setStats(getStats()); setScreen('history'); }}
            className="flex-1 py-3 rounded-lg text-sm font-semibold uppercase tracking-wider cursor-pointer"
            style={{ background: 'var(--surface)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
          >
            History
          </button>
        </div>
      </div>
    );
  }

  if (screen === 'playing') {
    const timerColor = timeLeft <= 10 ? 'var(--red)' : timeLeft <= 20 ? 'var(--amber)' : 'var(--accent)';
    const timerPct = (timeLeft / 45) * 100;
    const effectiveDist = effectiveAnswer !== null ? Math.abs(effectiveAnswer - puzzle.target) : null;

    return (
      <div className="flex flex-col min-h-dvh px-4 py-4">
        {/* Timer */}
        <div className="w-full max-w-sm mx-auto mb-1">
          <div className="rounded-full h-1 overflow-hidden" style={{ background: 'var(--border)' }}>
            <div
              className="h-full rounded-full transition-all duration-1000 ease-linear"
              style={{ width: `${timerPct}%`, background: timerColor }}
            />
          </div>
        </div>
        <div className="text-center font-mono text-lg font-bold tabular-nums mb-3" style={{ color: timerColor }}>
          {String(timeLeft).padStart(2, '0')}
        </div>

        {/* Target */}
        <div className="text-center mb-3">
          <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: 'var(--text-dim)' }}>Target</div>
          <div className="font-mono text-5xl font-extrabold tracking-tight">{puzzle.target}</div>
          {effectiveAnswer !== null && (
            <div className="font-mono text-xs mt-1.5 font-medium" style={{ color: effectiveDist === 0 ? 'var(--accent)' : 'var(--text-dim)' }}>
              {effectiveDist === 0 ? 'EXACT' : `Best: ${effectiveAnswer} (${effectiveDist} off)`}
            </div>
          )}
        </div>

        {/* Completed steps */}
        {steps.length > 0 && (
          <div className="w-full max-w-sm mx-auto mb-2 space-y-1">
            {steps.map((s, i) => (
              <div
                key={i}
                className="rounded-md px-3 py-1.5 text-xs font-mono flex justify-between items-center"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <span style={{ color: 'var(--text-dim)' }}>{s.expression}</span>
                <span className="font-bold" style={{
                  color: s.result === puzzle.target ? 'var(--accent)' : 'var(--text)'
                }}>= {s.result}</span>
              </div>
            ))}
          </div>
        )}

        {/* Current expression */}
        <div
          className="w-full max-w-sm mx-auto rounded-lg p-3 mb-1 min-h-[52px] flex items-center justify-center"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          {tokens.length === 0 ? (
            <span className="text-xs uppercase tracking-widest" style={{ color: 'var(--text-dim)' }}>
              {steps.length > 0 ? 'Continue...' : 'Tap a number'}
            </span>
          ) : (
            <span className="font-mono text-xl font-bold tabular-nums">
              {expressionToString(tokens)}
              {currentValue !== null && tokens.length >= 3 && !expectingNumber && (
                <span style={{ color: currentValue === puzzle.target ? 'var(--accent)' : 'var(--text-dim)' }}>
                  {' '}= {currentValue}
                </span>
              )}
            </span>
          )}
        </div>

        <div className="h-2" />

        {/* Number tiles */}
        <div className="grid grid-cols-3 gap-1.5 w-full max-w-sm mx-auto mb-2">
          {tiles.filter(t => !consumedTileIds.has(t.id)).map(tile => {
            const isUsedInExpr = pendingTileIds.has(tile.id);
            const isOrigLarge = !tile.derived && tile.id === 0;
            return (
              <button
                key={tile.id}
                disabled={isUsedInExpr || !expectingNumber}
                onClick={() => tapNumber(tile.id, tile.value)}
                className="py-3 rounded-lg font-mono text-xl font-bold transition-all cursor-pointer"
                style={{
                  background: isUsedInExpr
                    ? 'var(--bg)'
                    : tile.derived
                      ? 'var(--derived-dim)'
                      : isOrigLarge
                        ? 'var(--accent-dim)'
                        : 'var(--surface)',
                  color: isUsedInExpr
                    ? 'var(--text-dim)'
                    : tile.derived
                      ? 'var(--derived)'
                      : isOrigLarge
                        ? 'var(--accent)'
                        : 'var(--text)',
                  opacity: isUsedInExpr ? 0.3 : (!expectingNumber ? 0.4 : 1),
                  border: tile.derived && !isUsedInExpr
                    ? '1px solid var(--derived)'
                    : isOrigLarge && !isUsedInExpr
                      ? '1px solid var(--accent)'
                      : '1px solid var(--border)',
                }}
              >
                {tile.value}
              </button>
            );
          })}
        </div>

        {/* Operators */}
        <div className="grid grid-cols-4 gap-1.5 w-full max-w-sm mx-auto mb-2">
          {['+', '−', '×', '÷'].map(op => {
            const actualOp = op === '−' ? '-' : op;
            return (
              <button
                key={op}
                disabled={expectingNumber}
                onClick={() => tapOp(actualOp)}
                className="py-2.5 rounded-lg font-mono text-lg font-bold transition-all cursor-pointer"
                style={{
                  background: expectingNumber ? 'var(--surface)' : 'var(--amber-dim)',
                  color: expectingNumber ? 'var(--text-dim)' : 'var(--amber)',
                  opacity: expectingNumber ? 0.4 : 1,
                  border: expectingNumber ? '1px solid var(--border)' : '1px solid var(--amber)',
                }}
              >
                {op}
              </button>
            );
          })}
        </div>

        {/* Controls row */}
        <div className="grid grid-cols-3 gap-1.5 w-full max-w-sm mx-auto mb-2">
          <button
            onClick={clearExpression}
            className="py-2.5 rounded-lg text-xs font-semibold uppercase tracking-wider cursor-pointer"
            style={{ background: 'var(--surface)', color: 'var(--text-dim)', border: '1px solid var(--border)' }}
          >
            Clear
          </button>
          <button
            onClick={undo}
            className="py-2.5 rounded-lg text-xs font-semibold uppercase tracking-wider cursor-pointer"
            style={{ background: 'var(--surface)', color: 'var(--text-dim)', border: '1px solid var(--border)' }}
          >
            Undo
          </button>
          <button
            onClick={evaluate}
            disabled={!canEvaluate}
            className="py-2.5 rounded-lg font-mono text-lg font-bold cursor-pointer"
            style={{
              background: canEvaluate ? 'var(--accent-dim)' : 'var(--surface)',
              color: canEvaluate ? 'var(--accent)' : 'var(--text-dim)',
              border: canEvaluate ? '1px solid var(--accent)' : '1px solid var(--border)',
            }}
          >
            =
          </button>
        </div>

        {/* Submit */}
        <button
          onClick={handleFinish}
          className="w-full max-w-sm mx-auto py-3 rounded-lg text-sm font-bold uppercase tracking-wider cursor-pointer"
          style={{
            background: effectiveAnswer !== null ? 'var(--accent)' : 'var(--surface)',
            color: effectiveAnswer !== null ? 'var(--accent-text)' : 'var(--text-dim)',
            border: effectiveAnswer !== null ? 'none' : '1px solid var(--border)',
          }}
        >
          Submit{effectiveAnswer !== null ? ` → ${effectiveAnswer}` : ''}
        </button>
      </div>
    );
  }

  // HOME
  return (
    <div className="flex flex-col items-center justify-center min-h-dvh px-4">
      {/* Title */}
      <div className="mb-10 text-center">
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] mb-3" style={{ color: 'var(--text-dim)' }}>
          — Daily —
        </div>
        <h1 className="font-mono text-4xl font-extrabold tracking-tight mb-2">
          Numbers
        </h1>
        <div className="w-8 h-px mx-auto mb-3" style={{ background: 'var(--accent)' }} />
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          6 numbers. 1 target. 45 seconds.
        </p>
      </div>

      {/* Puzzle card */}
      <div
        className="rounded-lg p-5 mb-6 w-full max-w-xs text-center"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: 'var(--text-dim)' }}>
          Puzzle
        </div>
        <div className="font-mono text-2xl font-bold">
          #{String(puzzle.dayNumber).padStart(3, '0')}
        </div>
      </div>

      <button
        onClick={startGame}
        className="w-full max-w-xs py-3.5 rounded-lg text-sm font-bold uppercase tracking-wider mb-4 active:scale-[0.98] transition-transform cursor-pointer"
        style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
      >
        Play
      </button>

      {getHistory().length > 0 && (
        <button
          onClick={() => { setStats(getStats()); setScreen('history'); }}
          className="text-xs font-semibold uppercase tracking-widest cursor-pointer"
          style={{ color: 'var(--text-dim)', background: 'none', border: 'none' }}
        >
          History
        </button>
      )}
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg p-3 text-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="font-mono text-xl font-bold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-widest mt-0.5" style={{ color: 'var(--text-dim)' }}>{label}</div>
    </div>
  );
}

function HistoryScreen({ onBack }: { onBack: () => void }) {
  const history = getHistory().sort((a, b) => b.dayNumber - a.dayNumber);
  const stats = getStats();

  return (
    <div className="flex flex-col min-h-dvh px-4 py-6">
      <div className="flex items-center mb-6 max-w-sm mx-auto w-full">
        <button
          onClick={onBack}
          className="text-xs font-semibold uppercase tracking-widest cursor-pointer"
          style={{ color: 'var(--text-muted)', background: 'none', border: 'none' }}
        >
          Back
        </button>
        <h1 className="font-mono text-lg font-bold flex-1 text-center mr-8">History</h1>
      </div>

      <div className="grid grid-cols-2 gap-2 w-full max-w-sm mx-auto mb-6">
        <StatBox label="Played" value={stats.played} />
        <StatBox label="Exact" value={stats.perfectCount} />
        <StatBox label="Best" value={stats.bestScore === Infinity ? '—' : stats.bestScore} />
        <StatBox label="Avg" value={stats.averageScore} />
        <StatBox label="Streak" value={stats.currentStreak} />
        <StatBox label="Max" value={stats.maxStreak} />
      </div>

      <div className="w-full max-w-sm mx-auto space-y-1.5 overflow-y-auto flex-1">
        {history.length === 0 ? (
          <p className="text-center py-8 text-xs uppercase tracking-widest" style={{ color: 'var(--text-dim)' }}>
            No games yet
          </p>
        ) : (
          history.map(r => {
            const color = r.score === 0 ? 'var(--accent)' : r.score <= 10 ? 'var(--amber)' : 'var(--red)';
            return (
              <div
                key={r.dayNumber}
                className="rounded-lg p-3.5 flex items-center justify-between"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <div>
                  <div className="font-mono text-sm font-bold">#{String(r.dayNumber).padStart(3, '0')}</div>
                  <div className="font-mono text-xs" style={{ color: 'var(--text-dim)' }}>
                    {r.target} → {r.answer ?? '—'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-lg font-extrabold" style={{ color }}>
                    {r.score === 0 ? 'Exact' : r.score}
                  </div>
                  {r.score > 0 && (
                    <div className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-dim)' }}>off</div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
