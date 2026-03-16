import { useState, useEffect, useCallback, useRef } from 'react';
import {
  generatePuzzle,
  evaluateExpression,
  expressionToString,
  getScore,
  getScoreLabel,
  getScoreEmoji,
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

// A number tile in the pool — original or derived from an intermediate step
interface Tile {
  id: number;
  value: number;
  derived: boolean;
}

// A completed intermediate calculation
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

  // Tile pool: starts as original 6, grows with intermediate results
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [tokens, setTokens] = useState<Token[]>([]);
  // Tiles used in the CURRENT expression (not yet committed)
  const [pendingTileIds, setPendingTileIds] = useState<Set<number>>(new Set());
  // Tiles consumed by completed steps (permanently unavailable unless step is undone)
  const [consumedTileIds, setConsumedTileIds] = useState<Set<number>>(new Set());
  // Best answer seen across all steps
  const [bestAnswer, setBestAnswer] = useState<number | null>(null);

  const [timeLeft, setTimeLeft] = useState(45);
  const [result, setResult] = useState<GameResult | null>(null);
  const [stats, setStats] = useState<Stats>(getStats());
  const [copied, setCopied] = useState(false);
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

  // All unavailable tile ids (consumed by steps + used in current expression)
  const unavailableTileIds = new Set([...consumedTileIds, ...pendingTileIds]);

  // The "answer" to submit: best of (current expression value, best intermediate result)
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

  // Timer
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

  const [finishing, setFinishing] = useState(false);

  const handleFinish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    setFinishing(true);
  }, []);

  useEffect(() => {
    if (!finishing) return;
    setFinishing(false);

    // Determine best answer: check current expression + bestAnswer
    const candidates: number[] = [];
    if (bestAnswer !== null) candidates.push(bestAnswer);
    if (currentValue !== null && !expectingNumber) candidates.push(currentValue);

    const answer = candidates.length > 0
      ? candidates.reduce((best, c) =>
          Math.abs(c - puzzle.target) < Math.abs(best - puzzle.target) ? c : best
        )
      : null;

    const score = getScore(puzzle.target, answer);

    // Build expression summary from all steps + current
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

  // Time's up
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
    // If current expression has tokens, undo last token
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

    // If no current expression but there are steps, undo last step
    if (steps.length > 0) {
      const lastStep = steps[steps.length - 1];
      // Remove the derived tile
      setTiles(prev => prev.filter(t => t.id !== lastStep.producedTileId));
      // Restore consumed tiles
      setConsumedTileIds(prev => {
        const next = new Set(prev);
        for (const id of lastStep.consumedTileIds) {
          next.delete(id);
        }
        return next;
      });
      // Restore the expression from that step
      setTokens(lastStep.tokens);
      setPendingTileIds(new Set(lastStep.consumedTileIds));
      setSteps(prev => prev.slice(0, -1));

      // Recalculate best answer
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
    // Only clear the current expression, not steps
    setPendingTileIds(new Set());
    setTokens([]);
  };

  // = button: evaluate current expression, add result to tile pool
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

    // Update best answer
    const newBest = bestAnswer === null
      ? currentValue
      : Math.abs(currentValue - puzzle.target) < Math.abs(bestAnswer - puzzle.target)
        ? currentValue
        : bestAnswer;

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
    const emoji = getScoreEmoji(result.score);
    const label = getScoreLabel(result.score);
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh px-4 py-8">
        <div className="text-6xl mb-4">{emoji}</div>
        <h1 className="text-3xl font-bold mb-1" style={{ color: 'var(--text)' }}>
          {label}
        </h1>
        <p className="text-lg mb-6" style={{ color: 'var(--text-muted)' }}>
          Countdown #{result.dayNumber}
        </p>

        <div className="rounded-2xl p-6 mb-6 w-full max-w-sm" style={{ background: 'var(--surface)' }}>
          <div className="text-sm uppercase tracking-wider mb-1" style={{ color: 'var(--text-dim)' }}>Target</div>
          <div className="text-5xl font-bold mb-4 tabular-nums">{result.target}</div>

          <div className="text-sm uppercase tracking-wider mb-1" style={{ color: 'var(--text-dim)' }}>Your answer</div>
          <div className="text-3xl font-bold mb-1 tabular-nums" style={{ color: result.score === 0 ? 'var(--success)' : 'var(--text)' }}>
            {result.answer ?? '—'}
          </div>
          <div className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
            {result.expression}
          </div>

          {result.score > 0 && (
            <div className="text-lg font-semibold" style={{ color: result.score <= 10 ? 'var(--warning)' : 'var(--danger)' }}>
              {result.score} away
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 w-full max-w-sm mb-6">
          <StatBox label="Played" value={stats.played} />
          <StatBox label="Perfects" value={stats.perfectCount} />
          <StatBox label="Streak" value={stats.currentStreak} />
        </div>

        <div className="flex gap-3 w-full max-w-sm">
          <button onClick={share} className="flex-1 py-3 rounded-xl text-lg font-semibold text-white cursor-pointer" style={{ background: 'var(--accent)' }}>
            {copied ? 'Copied!' : 'Share'}
          </button>
          <button onClick={() => { setStats(getStats()); setScreen('history'); }} className="flex-1 py-3 rounded-xl text-lg font-semibold cursor-pointer" style={{ background: 'var(--surface)', color: 'var(--text)' }}>
            History
          </button>
        </div>
      </div>
    );
  }

  if (screen === 'playing') {
    const timerColor = timeLeft <= 10 ? 'var(--danger)' : timeLeft <= 20 ? 'var(--warning)' : 'var(--text)';
    const timerPct = (timeLeft / 45) * 100;

    // Determine distance for effective answer
    const effectiveDist = effectiveAnswer !== null ? Math.abs(effectiveAnswer - puzzle.target) : null;

    return (
      <div className="flex flex-col min-h-dvh px-4 py-4">
        {/* Timer bar */}
        <div className="w-full max-w-sm mx-auto mb-2 rounded-full h-2 overflow-hidden" style={{ background: 'var(--surface)' }}>
          <div
            className="h-full rounded-full transition-all duration-1000 ease-linear"
            style={{ width: `${timerPct}%`, background: timerColor }}
          />
        </div>
        <div className="text-center text-2xl font-bold tabular-nums mb-3" style={{ color: timerColor }}>
          {timeLeft}s
        </div>

        {/* Target + best so far */}
        <div className="text-center mb-3">
          <div className="text-sm uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Target</div>
          <div className="text-5xl font-bold tabular-nums">{puzzle.target}</div>
          {effectiveAnswer !== null && (
            <div className="text-sm mt-1 font-medium" style={{ color: effectiveDist === 0 ? 'var(--success)' : 'var(--text-muted)' }}>
              {effectiveDist === 0 ? 'Perfect!' : `Best so far: ${effectiveAnswer} (${effectiveDist} away)`}
            </div>
          )}
        </div>

        {/* Completed steps */}
        {steps.length > 0 && (
          <div className="w-full max-w-sm mx-auto mb-2 space-y-1">
            {steps.map((s, i) => (
              <div
                key={i}
                className="rounded-lg px-3 py-1.5 text-sm font-mono flex justify-between items-center"
                style={{ background: 'var(--surface)', color: 'var(--text-muted)' }}
              >
                <span>{s.expression}</span>
                <span className="font-bold" style={{
                  color: s.result === puzzle.target ? 'var(--success)' : 'var(--text)'
                }}>= {s.result}</span>
              </div>
            ))}
          </div>
        )}

        {/* Current expression */}
        <div className="w-full max-w-sm mx-auto rounded-xl p-4 mb-1 min-h-[56px] flex items-center justify-center" style={{ background: 'var(--surface)' }}>
          {tokens.length === 0 ? (
            <span style={{ color: 'var(--text-dim)' }}>
              {steps.length > 0 ? 'Continue building...' : 'Tap a number to start'}
            </span>
          ) : (
            <span className="text-2xl font-mono font-bold tabular-nums">
              {expressionToString(tokens)}
              {currentValue !== null && tokens.length >= 3 && !expectingNumber && (
                <span style={{ color: currentValue === puzzle.target ? 'var(--success)' : 'var(--text-muted)' }}>
                  {' '}= {currentValue}
                </span>
              )}
            </span>
          )}
        </div>

        {/* Spacer for consistent layout */}
        <div className="h-2" />

        {/* Number tiles */}
        <div className="grid grid-cols-3 gap-2 w-full max-w-sm mx-auto mb-3">
          {tiles.filter(t => !consumedTileIds.has(t.id)).map(tile => {
            const isUsedInExpr = pendingTileIds.has(tile.id);
            const isOrigLarge = !tile.derived && tile.id === 0;
            return (
              <button
                key={tile.id}
                disabled={isUsedInExpr || !expectingNumber}
                onClick={() => tapNumber(tile.id, tile.value)}
                className="py-3.5 rounded-xl text-2xl font-bold transition-all cursor-pointer relative"
                style={{
                  background: isUsedInExpr
                    ? 'var(--bg)'
                    : tile.derived
                      ? 'var(--success)'
                      : isOrigLarge
                        ? 'var(--accent)'
                        : 'var(--surface)',
                  color: isUsedInExpr ? 'var(--text-dim)' : 'var(--text)',
                  opacity: isUsedInExpr ? 0.4 : (!expectingNumber ? 0.5 : 1),
                  border: tile.derived && !isUsedInExpr
                    ? '2px solid var(--success)'
                    : isOrigLarge && !isUsedInExpr
                      ? '2px solid var(--accent-hover)'
                      : '2px solid transparent',
                }}
              >
                {tile.value}
              </button>
            );
          })}
        </div>

        {/* Operators */}
        <div className="grid grid-cols-4 gap-2 w-full max-w-sm mx-auto mb-3">
          {['+', '−', '×', '÷'].map(op => {
            const actualOp = op === '−' ? '-' : op;
            return (
              <button
                key={op}
                disabled={expectingNumber}
                onClick={() => tapOp(actualOp)}
                className="py-3 rounded-xl text-2xl font-bold transition-all cursor-pointer"
                style={{
                  background: 'var(--surface)',
                  color: expectingNumber ? 'var(--text-dim)' : 'var(--warning)',
                  opacity: expectingNumber ? 0.4 : 1,
                }}
              >
                {op}
              </button>
            );
          })}
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-3 gap-2 w-full max-w-sm mx-auto mb-3">
          <button onClick={clearExpression} className="py-3 rounded-xl font-semibold cursor-pointer" style={{ background: 'var(--surface)', color: 'var(--text-muted)' }}>
            Clear
          </button>
          <button onClick={undo} className="py-3 rounded-xl font-semibold cursor-pointer" style={{ background: 'var(--surface)', color: 'var(--text-muted)' }}>
            Undo
          </button>
          <button
            onClick={evaluate}
            disabled={!canEvaluate}
            className="py-3 rounded-xl font-bold text-xl cursor-pointer"
            style={{
              background: canEvaluate ? 'var(--warning)' : 'var(--surface)',
              color: canEvaluate ? 'var(--bg)' : 'var(--text-dim)',
            }}
          >
            =
          </button>
        </div>

        {/* Submit */}
        <button
          onClick={handleFinish}
          className="w-full max-w-sm mx-auto py-3 rounded-xl text-lg font-bold cursor-pointer"
          style={{
            background: effectiveAnswer !== null ? 'var(--success)' : 'var(--surface)',
            color: effectiveAnswer !== null ? 'white' : 'var(--text-dim)',
          }}
        >
          Submit{effectiveAnswer !== null ? ` (${effectiveAnswer})` : ''}
        </button>
      </div>
    );
  }

  // HOME
  return (
    <div className="flex flex-col items-center justify-center min-h-dvh px-4">
      <div className="mb-8 text-center">
        <h1 className="text-5xl font-bold mb-2">Countdown</h1>
        <p className="text-lg" style={{ color: 'var(--text-muted)' }}>Daily numbers puzzle</p>
      </div>

      <div className="rounded-2xl p-6 mb-6 w-full max-w-xs text-center" style={{ background: 'var(--surface)' }}>
        <div className="text-sm uppercase tracking-wider mb-1" style={{ color: 'var(--text-dim)' }}>Today's puzzle</div>
        <div className="text-lg font-semibold">#{puzzle.dayNumber}</div>
        <div className="mt-3 text-sm" style={{ color: 'var(--text-muted)' }}>
          6 numbers. 1 target. 45 seconds.
        </div>
      </div>

      <button
        onClick={startGame}
        className="w-full max-w-xs py-4 rounded-xl text-xl font-bold text-white mb-4 active:scale-95 transition-transform cursor-pointer"
        style={{ background: 'var(--accent)' }}
      >
        Play
      </button>

      {getHistory().length > 0 && (
        <button
          onClick={() => { setStats(getStats()); setScreen('history'); }}
          className="text-lg font-semibold cursor-pointer"
          style={{ color: 'var(--text-muted)', background: 'none', border: 'none' }}
        >
          History
        </button>
      )}
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl p-3 text-center" style={{ background: 'var(--surface)' }}>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>{label}</div>
    </div>
  );
}

function HistoryScreen({ onBack }: { onBack: () => void }) {
  const history = getHistory().sort((a, b) => b.dayNumber - a.dayNumber);
  const stats = getStats();

  return (
    <div className="flex flex-col min-h-dvh px-4 py-6">
      <div className="flex items-center mb-6 max-w-sm mx-auto w-full">
        <button onClick={onBack} className="text-lg font-semibold cursor-pointer" style={{ color: 'var(--accent)', background: 'none', border: 'none' }}>
          Back
        </button>
        <h1 className="text-2xl font-bold flex-1 text-center mr-12">History</h1>
      </div>

      <div className="grid grid-cols-2 gap-3 w-full max-w-sm mx-auto mb-6">
        <StatBox label="Played" value={stats.played} />
        <StatBox label="Perfects" value={stats.perfectCount} />
        <StatBox label="Best" value={stats.bestScore === Infinity ? '—' : stats.bestScore} />
        <StatBox label="Avg Distance" value={stats.averageScore} />
        <StatBox label="Streak" value={stats.currentStreak} />
        <StatBox label="Max Streak" value={stats.maxStreak} />
      </div>

      <div className="w-full max-w-sm mx-auto space-y-2 overflow-y-auto flex-1">
        {history.length === 0 ? (
          <p className="text-center py-8" style={{ color: 'var(--text-dim)' }}>No games yet</p>
        ) : (
          history.map(r => (
            <div key={r.dayNumber} className="rounded-xl p-4 flex items-center justify-between" style={{ background: 'var(--surface)' }}>
              <div>
                <div className="font-semibold">#{r.dayNumber}</div>
                <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Target: {r.target}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xl font-bold tabular-nums" style={{ color: r.score === 0 ? 'var(--success)' : 'var(--text)' }}>
                  {r.score === 0 ? 'Perfect' : r.score}
                </div>
                <div className="text-xs" style={{ color: 'var(--text-dim)' }}>
                  {r.score === 0 ? '' : 'away'}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
