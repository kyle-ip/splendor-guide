import { useEffect, useMemo, useState } from 'react';
import type { MessageKey } from '@/i18n/messages';
import { useGemLabels } from '@/i18n/useGemLabels';
import { useI18n } from '@/i18n/I18nProvider';
import { gems } from '@/lib/assets';
import { pushCappedHistory } from '@/lib/practiceHistory';
import { preserveScroll } from '@/lib/preserveScroll';
import { loadSession, saveSession, clearSession } from '@/lib/practiceSession';
import type { SoloCard } from '@/data/solo-cards';
import { payForCard } from '@/data/solo-cards';
import {
  PracticeShell,
  ReservedHand,
} from '@/features/solo/shared';
import {
  PracticeCoaching,
  buildStandardCoaching,
} from '@/features/solo/PracticeCoaching';
import { usePurchaseFx } from '@/features/solo/PurchaseFx';
import { useSoloToast } from '@/features/solo/SoloToast';
import { useSoloHints } from '@/features/solo/SoloHints';
import { useBankTakeFx } from '@/features/solo/BankTakeFx';
import {
  useCeremonyFx,
  useTurnPulseOnChange,
  useWinCelebrateOnce,
} from '@/features/solo/CeremonyFx';
import {
  BoardTable,
  BuyableCard,
  HandDropZone,
  ReserveDropZone,
  NobleTile,
  getTakeRejectionReason,
  isTakeComplete,
  type TakeColor,
} from '@/features/solo/Board';
import { chooseAiAction } from './ai';
import {
  applyAction,
  createGame,
  currentSeat,
  findCard,
  passTurn,
  setPendingTake,
} from './engine';
import {
  contestedCardIds,
  selectStandardTip,
} from './practiceTips';
import { recommendHumanMove } from './moveHints';
import { MoveHintBanner } from './MoveHintBanner';
import { SetupForm, type SetupValues } from './SetupForm';
import {
  SideTable,
  SeatPanel,
  seatDisplayName,
  seatsToSides,
} from './SeatPanel';
import { StandardTipBanner } from './StandardTipBanner';
import { InkRule } from '@/components/manuscript/WoodcutFrame';
import { useScrollLock } from '@/lib/useScrollLock';
import type { AiStyle, Color, GameState, GemKey } from './types';

const AI_DELAY_MS = 420;
const AI_FAST_MS = 160;
const STD_SESSION_KEY = 'splendor-standard-session';

type StdSession = { setup: SetupValues; state: GameState };

function normalizeSetup(setup?: Partial<SetupValues>): SetupValues {
  return {
    playerCount: setup?.playerCount ?? 2,
    humanSeat: setup?.humanSeat ?? 0,
    difficulty: setup?.difficulty ?? 'normal',
    aiStyle: setup?.aiStyle ?? 'balanced',
  };
}

function normalizeState(state: GameState): GameState {
  if (state.aiStyle) return state;
  return { ...state, aiStyle: 'balanced' as AiStyle };
}

function difficultyKey(d: SetupValues['difficulty']): MessageKey {
  if (d === 'easy') return 'stdDiff_easy';
  if (d === 'normal') return 'stdDiff_normal';
  return 'stdDiff_hard';
}

export function StandardPractice() {
  const { t } = useI18n();
  const labels = useGemLabels();
  const purchaseFx = usePurchaseFx();
  const toast = useSoloToast();
  const hints = useSoloHints();
  const bankFx = useBankTakeFx();
  const ceremonyFx = useCeremonyFx();

  const [setup, setSetup] = useState<SetupValues>(() => {
    const saved = loadSession<StdSession>(STD_SESSION_KEY);
    return normalizeSetup(saved?.setup);
  });
  const [playing, setPlaying] = useState(() => {
    const saved = loadSession<StdSession>(STD_SESSION_KEY);
    return Boolean(saved?.state && !saved.state.winnerIds.length);
  });
  const [state, setState] = useState<GameState | null>(() => {
    const saved = loadSession<StdSession>(STD_SESSION_KEY);
    if (saved?.state && !saved.state.winnerIds.length) {
      return normalizeState(saved.state);
    }
    return null;
  });
  const [history, setHistory] = useState<GameState[]>([]);
  const [fastAi, setFastAi] = useState(false);
  const [discardPick, setDiscardPick] = useState<GemKey[]>([]);
  const [dismissedTips, setDismissedTips] = useState<Set<string>>(
    () => new Set(),
  );
  const [missedDenials, setMissedDenials] = useState(0);

  useWinCelebrateOnce(
    Boolean(state && state.phase === 'done'),
    Boolean(state?.winnerIds.includes(0)),
    0,
  );
  useTurnPulseOnChange(
    state && state.phase !== 'done'
      ? `${state.currentSeat}-${state.turn}`
      : null,
    state?.currentSeat ?? 'player',
  );

  useEffect(() => {
    if (!playing || !state) {
      if (!playing) clearSession(STD_SESSION_KEY);
      return;
    }
    if (state.winnerIds.length > 0) clearSession(STD_SESSION_KEY);
    else saveSession(STD_SESSION_KEY, { setup, state });
  }, [playing, setup, state]);

  const startGame = () => {
    setHistory([]);
    setDiscardPick([]);
    setDismissedTips(new Set());
    setMissedDenials(0);
    const next = createGame(setup);
    setState(next);
    setPlaying(true);
    saveSession(STD_SESSION_KEY, { setup, state: next });
  };

  const backToSetup = () => {
    setPlaying(false);
    setState(null);
    setHistory([]);
    setDiscardPick([]);
    setDismissedTips(new Set());
    setMissedDenials(0);
    clearSession(STD_SESSION_KEY);
  };

  const noteMissedDenial = (
    s: GameState,
    humanId: number,
    action: { type: string; cardId?: string },
  ) => {
    const contested = contestedCardIds(s, humanId);
    if (contested.size === 0) return;
    const denied =
      (action.type === 'buy' || action.type === 'reserve') &&
      action.cardId != null &&
      contested.has(action.cardId);
    if (!denied) setMissedDenials((n) => n + 1);
  };

  const pushHistory = (s: GameState) => {
    setHistory((h) => pushCappedHistory(h, s, (x) => x.turn));
  };

  const undo = () => {
    setHistory((h) => {
      if (h.length === 0) return h;
      setDiscardPick([]);
      setState(h[h.length - 1]);
      return h.slice(0, -1);
    });
  };

  const humanSeat = state?.seats.find((s) => s.isHuman) ?? null;
  const active = state ? currentSeat(state) : null;

  const isHumanSeat =
    Boolean(state && humanSeat && state.currentSeat === humanSeat.id);

  // Block the human seat for their own market FX (lift→exit→settle).
  // AI FX keeps phase on the AI seat until apply, so it won't freeze the human.
  const humanMainTurn =
    isHumanSeat &&
    state?.phase === 'human' &&
    !purchaseFx.isAnimating;

  const humanChoosingNoble =
    isHumanSeat &&
    state?.phase === 'chooseNoble' &&
    !purchaseFx.isAnimating;

  const humanDiscarding =
    isHumanSeat &&
    state?.phase === 'discardGems' &&
    !purchaseFx.isAnimating;

  /** Keep viewport from auto-jumping on gem takes; manual scroll still works. */
  const lockScroll = Boolean(playing && state && state.phase !== 'done');
  useScrollLock(lockScroll);

  const contestedIds = useMemo(() => {
    if (!state || !humanSeat || !hints.enabled) return new Set<string>();
    return contestedCardIds(state, humanSeat.id);
  }, [state, humanSeat, hints.enabled]);

  const moveHint = useMemo(() => {
    if (!state || !humanSeat || !hints.enabled || !humanMainTurn) return null;
    // Keep banner mounted during gem picking so the page height does not jump.
    return recommendHumanMove(state);
  }, [state, humanSeat, hints.enabled, humanMainTurn]);

  const suggestedCardId = moveHint?.highlightCardId;

  const activeTip = useMemo(() => {
    if (!state || !humanSeat || !hints.enabled || !humanMainTurn) return null;
    return selectStandardTip(state, humanSeat.id, dismissedTips);
  }, [state, humanSeat, hints.enabled, humanMainTurn, dismissedTips]);

  const dismissTip = (id: string) => {
    setDismissedTips((prev) => new Set(prev).add(id));
  };

  useEffect(() => {
    setDiscardPick([]);
  }, [state?.phase, state?.currentSeat, state?.discardNeeded]);

  useEffect(() => {
    if (!state || state.phase === 'done') return;
    if (state.phase === 'human') return;
    if (state.phase === 'chooseNoble' && currentSeat(state).isHuman) return;
    if (state.phase === 'discardGems' && currentSeat(state).isHuman) return;
    if (purchaseFx.isAnimating) return;

    const delay = fastAi ? AI_FAST_MS : AI_DELAY_MS;
    const timer = window.setTimeout(() => {
      setState((s) => {
        if (!s || s.phase === 'done' || s.phase === 'human') return s;
        if (
          (s.phase === 'chooseNoble' || s.phase === 'discardGems') &&
          currentSeat(s).isHuman
        ) {
          return s;
        }

        const action = chooseAiAction(s);
        if (!action) {
          return passTurn(s);
        }

        const seatId = currentSeat(s).id;

        if (action.type === 'take') {
          const colors = action.colors;
          queueMicrotask(() =>
            bankFx.takeMany(colors, {
              toward: 'up',
              seatId,
            }),
          );
          return applyAction(s, action) ?? s;
        }

        if (action.type === 'claimNoble') {
          queueMicrotask(() => {
            ceremonyFx.nobleVisit(action.nobleId, seatId);
          });
          return applyAction(s, action) ?? s;
        }

        if (action.type === 'buy') {
          const found = findCard(s, action.cardId);
          if (!found) return applyAction(s, action) ?? s;

          const paidPreview = payForCard(
            currentSeat(s).hand,
            found.card.cost,
            currentSeat(s).bonuses,
          );
          if (paidPreview) {
            queueMicrotask(() =>
              bankFx.spendDiff(currentSeat(s).hand, paidPreview, {
                fromSeatId: seatId,
              }),
            );
          }

          // Display buys: animate first, then apply. Reserved buys apply now.
          if (found.level !== 'reserved') {
            queueMicrotask(() => {
              purchaseFx.run(found.card.id, 'ai', () => {
                setState((prev) => {
                  if (!prev) return prev;
                  return applyAction(prev, action) ?? prev;
                });
              });
            });
            return s;
          }

          return applyAction(s, action) ?? s;
        }

        if (action.type === 'reserve') {
          if (s.bank.gold > 0) {
            queueMicrotask(() =>
              bankFx.take('gold', { toward: 'up', seatId }),
            );
          }
          queueMicrotask(() => {
            purchaseFx.run(action.cardId, 'ai', () => {
              setState((prev) => {
                if (!prev) return prev;
                return applyAction(prev, action) ?? prev;
              });
            });
          });
          return s;
        }

        return applyAction(s, action) ?? s;
      });
    }, delay);

    return () => window.clearTimeout(timer);
  }, [
    state?.phase,
    state?.busyNonce,
    state?.currentSeat,
    state?.discardNeeded,
    state?.pendingNobles.length,
    fastAi,
    purchaseFx.isAnimating,
    bankFx,
    ceremonyFx,
    purchaseFx,
  ]);

  const pickGem = (color: TakeColor) => {
    if (!state || !humanMainTurn) return;
    preserveScroll(() => {
      const reason = getTakeRejectionReason(
        state.pendingTake as TakeColor[],
        color,
        state.bank,
      );
      if (reason) {
        toast.show(
          t(reason, {
            color: labels[color],
          } as { color: string }),
        );
        setState((s) => (s ? setPendingTake(s, []) : s));
        return;
      }

      bankFx.take(color, { toward: 'down' });

      setState((s) => {
        if (!s) return s;
        const pending = [...s.pendingTake, color] as Color[];
        if (!isTakeComplete(pending as TakeColor[])) {
          return setPendingTake(s, pending);
        }
        if (humanSeat) {
          noteMissedDenial(s, humanSeat.id, { type: 'take' });
        }
        pushHistory(s);
        return (
          applyAction({ ...s, pendingTake: [] }, { type: 'take', colors: pending }) ??
          s
        );
      });
    });
  };

  const reserve = (cardId: string) => {
    if (!state || !humanMainTurn) return;
    if (purchaseFx.isAnimating) return;
    const found = findCard(state, cardId);
    if (!found || found.level === 'reserved') return;
    const level = found.level;
    if (state.bank.gold > 0) {
      bankFx.take('gold', { toward: 'down' });
    }
    noteMissedDenial(state, currentSeat(state).id, { type: 'reserve', cardId });
    purchaseFx.run(cardId, 'player', () => {
      setState((s) => {
        if (!s) return s;
        pushHistory(s);
        return (
          applyAction(s, {
            type: 'reserve',
            cardId,
            level,
          }) ?? s
        );
      });
    });
  };

  const buy = (
    card: SoloCard,
    from: 'display' | 'reserved',
    level?: 1 | 2 | 3,
  ) => {
    if (!state || !humanMainTurn || state.pendingTake.length > 0) return;
    if (purchaseFx.isAnimating) return;
    if (!humanSeat) return;
    const paidPreview = payForCard(humanSeat.hand, card.cost, humanSeat.bonuses);
    if (!paidPreview) return;

    noteMissedDenial(state, humanSeat.id, { type: 'buy', cardId: card.id });
    bankFx.spendDiff(humanSeat.hand, paidPreview);

    if (from === 'reserved') {
      // Reserved buys leave the market unchanged — apply immediately.
      setState((s) => {
        if (!s) return s;
        pushHistory(s);
        return (
          applyAction(s, {
            type: 'buy',
            cardId: card.id,
            from,
            level,
          }) ?? s
        );
      });
      return;
    }

    purchaseFx.run(card.id, 'player', () => {
      setState((s) => {
        if (!s) return s;
        pushHistory(s);
        return (
          applyAction(s, {
            type: 'buy',
            cardId: card.id,
            from,
            level,
          }) ?? s
        );
      });
    });
  };

  const claimNoble = (nobleId: number) => {
    if (!state || state.phase !== 'chooseNoble') return;
    ceremonyFx.nobleVisit(nobleId, 'player', () => {
      setState((s) => {
        if (!s || s.phase !== 'chooseNoble') return s;
        pushHistory(s);
        return applyAction(s, { type: 'claimNoble', nobleId }) ?? s;
      });
    });
  };

  useEffect(() => {
    if (!state || state.phase !== 'chooseNoble') return;
    if (!currentSeat(state).isHuman) return;
    if (state.pendingNobles.length !== 1) return;
    const id = state.pendingNobles[0].id;
    const timer = window.setTimeout(() => claimNoble(id), 120);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.phase, state?.pendingNobles, state?.currentSeat]);

  const toggleDiscard = (gem: GemKey) => {
    if (!state || !humanDiscarding) return;
    const seat = currentSeat(state);
    const already = discardPick.filter((g) => g === gem).length;
    if (already >= seat.hand[gem]) return;
    if (discardPick.length >= state.discardNeeded) return;

    const next = [...discardPick, gem];
    if (next.length === state.discardNeeded) {
      pushHistory(state);
      setDiscardPick([]);
      setState((s) => (s && applyAction(s, { type: 'discard', gems: next })) || s);
    } else {
      setDiscardPick(next);
    }
  };

  if (!playing || !state) {
    return (
      <div className="space-y-6">
        <header>
          <p className="font-serif text-[11px] tracking-[0.22em] uppercase text-splendor-muted mb-2">
            {t('navStandardPractice')}
          </p>
          <h1 className="page-title">{t('stdTitle')}</h1>
          <InkRule className="my-4" />
          <p className="font-serif text-splendor-muted leading-relaxed max-w-2xl">
            {t('stdIntro')}
          </p>
        </header>
        <SetupForm
          value={setup}
          onChange={setSetup}
          onStart={startGame}
          t={t}
        />
      </div>
    );
  }

  const me = humanSeat!;
  const sides = seatsToSides(state.seats, me.id);

  const phaseLocked =
    !humanMainTurn ||
    state.pendingTake.length > 0 ||
    state.phase === 'chooseNoble' ||
    state.phase === 'discardGems';

  const winnerText = (() => {
    if (state.phase !== 'done') return null;
    const ids = state.winnerIds;
    if (ids.length !== 1) return t('stdTie');
    const w = state.seats[ids[0]];
    if (w?.isHuman) return t('stdWinYou');
    return t('stdWinAi', { name: seatDisplayName(w, t) });
  })();

  const renderSeat = (seat: typeof me, opts?: { isHumanControls?: boolean }) => (
    <SeatPanel
      key={seat.id}
      seat={seat}
      isCurrent={state.currentSeat === seat.id && state.phase !== 'done'}
      compact
      showTokens
    >
      {opts?.isHumanControls && (
        <div className="space-y-2 pt-1">
          <HandDropZone
            hand={me.hand}
            pending={state.pendingTake as TakeColor[]}
            bank={state.bank}
            active={Boolean(humanMainTurn)}
            hideHandDisplay
            onDropGem={pickGem}
            onCancelPending={() =>
              setState((s) => (s ? setPendingTake(s, []) : s))
            }
          />
          <ReserveDropZone
            active={Boolean(humanMainTurn) && me.reserved.length < 3}
            title={t('soloReserved')}
            emptyHint={t('soloReserveDrop')}
            onDropCard={reserve}
          >
            {me.reserved.length > 0 ? (
              <ReservedHand
                cards={me.reserved}
                hand={me.hand}
                bonuses={me.bonuses}
                showHints={hints.enabled}
                onBuy={!phaseLocked ? (card) => buy(card, 'reserved') : undefined}
                isExiting={(id) => purchaseFx.isExiting(id)}
              />
            ) : undefined}
          </ReserveDropZone>
          {hints.enabled && (
            <div className="border-t border-splendor-line/25 pt-2 h-[6.75rem] overflow-y-auto overscroll-contain space-y-1.5">
              <p className="text-[10px] font-serif text-splendor-muted/80 leading-snug px-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                <span className="inline-flex items-center gap-1">
                  <svg
                    viewBox="0 0 12 11"
                    className="w-2.5 h-2 shrink-0"
                    aria-hidden
                  >
                    <polygon
                      points="6,0.75 11.25,10.25 0.75,10.25"
                      fill="var(--gem-emerald)"
                      stroke="#fff"
                      strokeWidth="1"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {t('hintDotSuggested')}
                </span>
                <span className="inline-flex items-center gap-1">
                  <svg
                    viewBox="0 0 12 11"
                    className="w-2.5 h-2 shrink-0"
                    aria-hidden
                  >
                    <polygon
                      points="0.75,0.75 11.25,0.75 6,10.25"
                      fill="var(--velvet)"
                      stroke="#fff"
                      strokeWidth="1"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {t('hintDotContested')}
                </span>
              </p>
              {moveHint && <MoveHintBanner hint={moveHint} compact />}
              {activeTip && (
                <StandardTipBanner
                  tip={activeTip}
                  onDismiss={dismissTip}
                  compact
                />
              )}
              {!moveHint && !activeTip && (
                <p className="text-[10px] font-serif text-splendor-muted/70 leading-snug px-0.5">
                  {t('hintSeatIdle')}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </SeatPanel>
  );

  return (
    <PracticeShell
      eyebrow={t('navStandardPractice')}
      title={t('stdTitle')}
      subtitle={t('stdPlayingSubtitle', {
        players: state.seats.length,
        difficulty: t(difficultyKey(setup.difficulty)),
      })}
      onReset={backToSetup}
      onUndo={undo}
      canUndo={history.length > 0 && Boolean(humanMainTurn)}
      focusBoard
      recordLine={
        state.endingRound && state.phase !== 'done'
          ? t('stdEndingRound')
          : t('stdTurnLine', {
              turn: state.turn,
              who: active ? seatDisplayName(active, t) : '—',
            })
      }
      headerExtra={
        <button
          type="button"
          onClick={() => setFastAi((v) => !v)}
          className={`btn-outline text-sm ${
            fastAi
              ? 'border-splendor-gold/70 bg-splendor-gold/10 text-splendor-velvet'
              : ''
          }`}
        >
          {fastAi ? t('stdAiFastOn') : t('stdAiFastOff')}
        </button>
      }
    >
      {winnerText && state && (
        <div className="panel p-4">
          <p className="font-serif text-lg text-splendor-velvet">{winnerText}</p>
          <p className="text-sm text-splendor-muted mt-2 font-serif">
            {state.seats
              .map((s) =>
                t('stdScoreSeat', {
                  name: seatDisplayName(s, t),
                  prestige: s.prestige,
                }),
              )
              .join(' · ')}
          </p>
          <PracticeCoaching
            tips={(() => {
              const human = state.seats.find((s) => s.isHuman);
              if (!human) return [];
              const takeActions = state.log.filter(
                (e) =>
                  (e.kind === 'take3' || e.kind === 'take2') &&
                  e.seat === human.id,
              ).length;
              const buyActions = state.log.filter(
                (e) => e.kind === 'buy' && e.seat === human.id,
              ).length;
              const humanNobles = state.log.filter(
                (e) => e.kind === 'noble' && e.seat === human.id,
              ).length;
              const oppNobles = state.log.filter(
                (e) => e.kind === 'noble' && e.seat !== human.id,
              ).length;
              const oppSeats = state.seats.filter((s) => !s.isHuman);
              const oppLead =
                oppSeats.reduce(
                  (best, s) =>
                    !best || s.prestige > best.prestige ? s : best,
                  null as (typeof oppSeats)[0] | null,
                ) ?? null;
              const oppMax = oppLead?.prestige ?? 0;
              return buildStandardCoaching({
                humanPrestige: human.prestige,
                humanCardCount: human.cardCount,
                humanNoblesApprox: humanNobles,
                oppMaxPrestige: oppMax,
                oppHasNobleLead: oppNobles > humanNobles,
                oppCardCountAtLead: oppLead?.cardCount ?? 0,
                takeActions,
                buyActions,
                won: state.winnerIds.includes(human.id),
                turns: state.turn,
                missedDenials,
              });
            })()}
          />
        </div>
      )}

      {humanChoosingNoble && (
        <div className="panel p-4 space-y-3">
          <p className="font-serif text-splendor-velvet">{t('stdChooseNoble')}</p>
          <div className="flex flex-wrap gap-3">
            {state.pendingNobles.map((n) => (
              <NobleTile
                key={n.id}
                noble={n}
                spendable
                onSpend={() => claimNoble(n.id)}
              />
            ))}
          </div>
        </div>
      )}

      {humanDiscarding && (
        <div className="panel p-4 space-y-3">
          <p className="font-serif text-splendor-velvet">
            {t('stdDiscardHint', {
              need: state.discardNeeded,
              picked: discardPick.length,
            })}
          </p>
          <div className="flex flex-wrap gap-2">
            {(
              ['emerald', 'sapphire', 'ruby', 'diamond', 'onyx', 'gold'] as GemKey[]
            ).map((gem) => {
              const count = me.hand[gem];
              if (count <= 0) return null;
              const picked = discardPick.filter((g) => g === gem).length;
              return (
                <button
                  key={gem}
                  type="button"
                  disabled={
                    picked >= count || discardPick.length >= state.discardNeeded
                  }
                  onClick={() => toggleDiscard(gem)}
                  className="btn-outline text-sm inline-flex items-center gap-1.5 disabled:opacity-40"
                >
                  <img
                    src={gems[gem]}
                    alt={labels[gem]}
                    className="w-6 h-6 object-contain"
                  />
                  {labels[gem]} ×{count}
                  {picked > 0 ? ` (−${picked})` : ''}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <SideTable
        west={
          <>
            {sides.west.map((seat) =>
              renderSeat(seat, { isHumanControls: seat.isHuman }),
            )}
          </>
        }
        east={
          <>
            {sides.east.map((seat) => renderSeat(seat))}
          </>
        }
        center={
          <BoardTable
            nobles={state.nobles}
            rows={[3, 2, 1].map((level) => {
              const lv = level as 1 | 2 | 3;
              const cards =
                lv === 1 ? state.l1 : lv === 2 ? state.l2 : state.l3;
              const deck =
                lv === 1 ? state.d1 : lv === 2 ? state.d2 : state.d3;
              return {
                level: lv,
                deckCount: deck.length,
                cards,
                renderCard: (card: SoloCard) => (
                  <BuyableCard
                    card={card}
                    hand={me.hand}
                    bonuses={me.bonuses}
                    phaseLocked={phaseLocked}
                    contested={contestedIds.has(card.id)}
                    suggested={suggestedCardId === card.id}
                    onBuy={() => buy(card, 'display', lv)}
                    reservable={
                      Boolean(humanMainTurn) &&
                      state.pendingTake.length === 0 &&
                      me.reserved.length < 3
                    }
                    onReserve={() => reserve(card.id)}
                  />
                ),
              };
            })}
            bank={state.bank}
            bankInteractive={Boolean(humanMainTurn)}
            onBankGem={pickGem}
          />
        }
      />
    </PracticeShell>
  );
}
