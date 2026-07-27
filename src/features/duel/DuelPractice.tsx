import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { MessageKey } from '@/i18n/messages';
import { useI18n } from '@/i18n/I18nProvider';
import { pushCappedHistory } from '@/lib/practiceHistory';
import { loadSession, saveSession, clearSession } from '@/lib/practiceSession';
import { PracticeShell, usePracticeChromeOptional } from '@/features/solo/shared';
import { useSoloToast } from '@/features/solo/SoloToast';
import { usePurchaseFx } from '@/features/solo/PurchaseFx';
import {
  useTurnPulseOnChange,
  useWinCelebrateOnce,
} from '@/features/solo/CeremonyFx';
import { InkRule } from '@/components/manuscript/WoodcutFrame';
import { useScrollLock } from '@/lib/useScrollLock';
import type { DuelGem, DuelJewelCard, DuelToken } from '@/data/duel-cards';
import { canAffordDuelCard } from '@/data/duel-cards';
import { isLegalTakeLine } from './engine';
import {
  applyAction,
  createDuelGame,
  currentSeat,
  listLegalActions,
} from './engine';
import { chooseDuelAiAction, isAiTurn } from './ai';
import { DuelBoard } from './Board';
import { DuelSeatPanel, duelSeatName } from './SeatPanel';
import { DuelSetupForm, type DuelSetupValues } from './SetupForm';
import type { DuelGameState } from './types';

const AI_DELAY_MS = 420;
const DUEL_SESSION_KEY = 'splendor-duel-session';

type DuelSession = { setup: DuelSetupValues; state: DuelGameState };

const DEFAULT_SETUP: DuelSetupValues = {
  mode: 'ai',
  humanSeat: 0,
  difficulty: 'normal',
};

function pushHistory(history: DuelGameState[], snapshot: DuelGameState) {
  return pushCappedHistory(history, snapshot, (s) => s.turn);
}

export function DuelPractice() {
  const { t } = useI18n();
  const toast = useSoloToast();
  const purchaseFx = usePurchaseFx();

  const [setup, setSetup] = useState<DuelSetupValues>(() => {
    const saved = loadSession<DuelSession>(DUEL_SESSION_KEY);
    return {
      ...DEFAULT_SETUP,
      ...saved?.setup,
      difficulty: saved?.setup?.difficulty ?? DEFAULT_SETUP.difficulty,
    };
  });
  const [playing, setPlaying] = useState(() => {
    const saved = loadSession<DuelSession>(DUEL_SESSION_KEY);
    return Boolean(saved?.state && saved.state.phase !== 'done');
  });
  const [state, setState] = useState<DuelGameState | null>(() => {
    const saved = loadSession<DuelSession>(DUEL_SESSION_KEY);
    if (saved?.state && saved.state.phase !== 'done') {
      return {
        ...saved.state,
        difficulty: saved.state.difficulty ?? saved.setup?.difficulty ?? 'normal',
      };
    }
    return null;
  });
  const [history, setHistory] = useState<DuelGameState[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [reserveGoldIndex, setReserveGoldIndex] = useState<number | null>(
    null,
  );
  const [privilegeMode, setPrivilegeMode] = useState(false);

  useScrollLock(Boolean(playing && state && state.phase !== 'done'));

  useEffect(() => {
    if (!playing || !state) {
      if (!playing) clearSession(DUEL_SESSION_KEY);
      return;
    }
    if (state.phase === 'done') clearSession(DUEL_SESSION_KEY);
    else saveSession(DUEL_SESSION_KEY, { setup, state });
  }, [playing, setup, state]);

  useWinCelebrateOnce(
    Boolean(state && state.phase === 'done'),
    Boolean(
      state &&
        state.winnerId !== null &&
        state.seats[state.winnerId]?.isHuman,
    ),
    state?.winnerId ?? 0,
  );
  useTurnPulseOnChange(
    state && state.phase !== 'done'
      ? `${state.currentSeat}-${state.turn}`
      : null,
    state?.currentSeat ?? 'player',
  );

  useEffect(() => {
    if (!state || !isAiTurn(state) || state.phase === 'done') return;
    if (purchaseFx.isAnimating) return;
    const id = window.setTimeout(() => {
      const action = chooseDuelAiAction(state);
      if (!action) return;

      if (action.type === 'buy' && action.from === 'pyramid') {
        purchaseFx.run(action.cardId, 'ai', () => {
          setState((prev) => {
            if (!prev) return prev;
            setHistory((h) => pushHistory(h, prev));
            return applyAction(prev, action);
          });
          setSelectedIndices([]);
          setReserveGoldIndex(null);
          setPrivilegeMode(false);
        });
        return;
      }

      if (action.type === 'reserve' && action.source.kind === 'pyramid') {
        purchaseFx.run(action.source.cardId, 'ai', () => {
          setState((prev) => {
            if (!prev) return prev;
            setHistory((h) => pushHistory(h, prev));
            return applyAction(prev, action);
          });
          setSelectedIndices([]);
          setReserveGoldIndex(null);
          setPrivilegeMode(false);
        });
        return;
      }

      setState((prev) => {
        if (!prev) return prev;
        setHistory((h) => pushHistory(h, prev));
        return applyAction(prev, action);
      });
      setSelectedIndices([]);
      setReserveGoldIndex(null);
      setPrivilegeMode(false);
    }, AI_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [state, purchaseFx.isAnimating, purchaseFx]);

  const commit = (next: DuelGameState, prev: DuelGameState) => {
    setHistory((h) => pushHistory(h, prev));
    setState(next);
    setSelectedIndices([]);
    setReserveGoldIndex(null);
    setPrivilegeMode(false);
  };

  const startGame = () => {
    const g = createDuelGame({
      mode: setup.mode,
      humanSeat: setup.humanSeat,
      difficulty: setup.mode === 'ai' ? setup.difficulty : 'normal',
    });
    setHistory([]);
    setState(g);
    setPlaying(true);
    setSelectedIndices([]);
    setReserveGoldIndex(null);
    setPrivilegeMode(false);
    saveSession(DUEL_SESSION_KEY, { setup, state: g });
  };

  const undo = () => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setState(prev);
      return h.slice(0, -1);
    });
    setSelectedIndices([]);
    setReserveGoldIndex(null);
    setPrivilegeMode(false);
  };

  const resetToSetup = () => {
    setPlaying(false);
    setState(null);
    setHistory([]);
    setSelectedIndices([]);
    setReserveGoldIndex(null);
    setPrivilegeMode(false);
    clearSession(DUEL_SESSION_KEY);
  };

  const humanActive =
    Boolean(playing && state) &&
    currentSeat(state!).isHuman &&
    state!.phase !== 'done' &&
    state!.phase !== 'aiBusy' &&
    !purchaseFx.isAnimating;

  const subtitle = useMemo(() => {
    if (!state) return t('duelIntroShort');
    if (state.phase === 'done' && state.winnerId !== null) {
      const winner = state.seats[state.winnerId];
      const reasonKey = (
        state.winReason === 'crowns'
          ? 'duelWin_crowns'
          : state.winReason === 'color'
            ? 'duelWin_color'
            : 'duelWin_prestige'
      ) as MessageKey;
      return t('duelWinner', {
        name: duelSeatName(winner, t),
        reason: t(reasonKey),
      });
    }
    if (setup.mode === 'ai') {
      return t('duelPlayingSubtitle', {
        mode: t('duelModeAi'),
        difficulty: t(
          setup.difficulty === 'easy'
            ? 'stdDiff_easy'
            : setup.difficulty === 'hard'
              ? 'stdDiff_hard'
              : 'stdDiff_normal',
        ),
        turn: state.turn,
      });
    }
    return t('duelPlayingSubtitleHotseat', {
      mode: t('duelModeHotseat'),
      turn: state.turn,
    });
  }, [state, setup.mode, setup.difficulty, t]);

  if (!playing || !state) {
    return (
      <div className="space-y-6">
        <header>
          <p className="font-serif text-[11px] tracking-[0.22em] uppercase text-splendor-muted mb-2">
            {t('navDuelPractice')}
          </p>
          <h1 className="page-title">{t('duelTitle')}</h1>
          <InkRule className="my-4" />
          <p className="font-serif text-splendor-muted leading-relaxed max-w-2xl">
            {t('duelIntroShort')}
          </p>
        </header>
        <DuelSetupForm
          value={setup}
          onChange={setSetup}
          onStart={startGame}
          t={t}
        />
      </div>
    );
  }

  const seat = currentSeat(state);
  const west = state.seats[0];
  const east = state.seats[1];

  const confirmTake = () => {
    if (!humanActive || selectedIndices.length === 0) return;
    if (!isLegalTakeLine(state.board, selectedIndices)) {
      toast.show(t('duelIllegalTake'));
      return;
    }
    commit(
      applyAction(state, {
        type: 'takeTokens',
        indices: [...selectedIndices],
      }),
      state,
    );
  };

  const onToggleToken = (index: number) => {
    if (!humanActive || privilegeMode || reserveGoldIndex !== null) return;
    if (state.board[index] === 'gold' || !state.board[index]) return;
    setSelectedIndices((prev) => {
      if (prev.includes(index)) return prev.filter((i) => i !== index);
      if (prev.length >= 3) return prev;
      const next = [...prev, index];
      if (next.length > 1 && !isLegalTakeLine(state.board, next)) {
        if (next.length === 2) return [index];
        return prev;
      }
      return next;
    });
  };

  const onBuyPyramid = (card: DuelJewelCard, level: 1 | 2 | 3) => {
    if (!humanActive || purchaseFx.isAnimating) return;
    if (!canAffordDuelCard(card, seat.hand, seat.bonuses)) return;
    purchaseFx.run(card.id, 'player', () => {
      commit(
        applyAction(state, {
          type: 'buy',
          cardId: card.id,
          from: 'pyramid',
          level,
        }),
        state,
      );
    });
  };

  const onReservePyramid = (card: DuelJewelCard, level: 1 | 2 | 3) => {
    if (!humanActive || reserveGoldIndex === null || purchaseFx.isAnimating) {
      return;
    }
    const goldIndex = reserveGoldIndex;
    purchaseFx.run(card.id, 'player', () => {
      commit(
        applyAction(state, {
          type: 'reserve',
          goldIndex,
          source: { kind: 'pyramid', cardId: card.id, level },
        }),
        state,
      );
    });
  };

  const onReserveDeck = (level: 1 | 2 | 3) => {
    if (!humanActive || reserveGoldIndex === null) return;
    commit(
      applyAction(state, {
        type: 'reserve',
        goldIndex: reserveGoldIndex,
        source: { kind: 'deck', level },
      }),
      state,
    );
  };

  const buyReserved = (cardId: string) => {
    if (!humanActive) return;
    commit(
      applyAction(state, { type: 'buy', cardId, from: 'reserved' }),
      state,
    );
  };

  return (
    <PracticeShell
      eyebrow={t('navDuelPractice')}
      title={t('duelTitle')}
      subtitle={subtitle}
      onReset={resetToSetup}
      onUndo={undo}
      canUndo={history.length > 0 && humanActive}
      focusBoard
      inlineChromeToggle
      recordLine={t('duelTurnLine', {
        turn: state.turn,
        who: duelSeatName(seat, t),
      })}
    >
      <DuelPlayBody
        humanActive={humanActive}
        selectedIndices={selectedIndices}
        setSelectedIndices={setSelectedIndices}
        confirmTake={confirmTake}
        state={state}
        commit={commit}
        reserveGoldIndex={reserveGoldIndex}
        setReserveGoldIndex={setReserveGoldIndex}
        privilegeMode={privilegeMode}
        setPrivilegeMode={setPrivilegeMode}
        setup={setup}
        west={west}
        east={east}
        seat={seat}
        onToggleToken={onToggleToken}
        onBuyPyramid={onBuyPyramid}
        onReservePyramid={onReservePyramid}
        onReserveDeck={onReserveDeck}
        buyReserved={buyReserved}
      />
    </PracticeShell>
  );
}

function DuelPlayBody({
  humanActive,
  selectedIndices,
  setSelectedIndices,
  confirmTake,
  state,
  commit,
  reserveGoldIndex,
  setReserveGoldIndex,
  privilegeMode,
  setPrivilegeMode,
  setup,
  west,
  east,
  seat,
  onToggleToken,
  onBuyPyramid,
  onReservePyramid,
  onReserveDeck,
  buyReserved,
}: {
  humanActive: boolean;
  selectedIndices: number[];
  setSelectedIndices: Dispatch<SetStateAction<number[]>>;
  confirmTake: () => void;
  state: DuelGameState;
  commit: (next: DuelGameState, prev: DuelGameState) => void;
  reserveGoldIndex: number | null;
  setReserveGoldIndex: Dispatch<SetStateAction<number | null>>;
  privilegeMode: boolean;
  setPrivilegeMode: Dispatch<SetStateAction<boolean>>;
  setup: DuelSetupValues;
  west: DuelGameState['seats'][0];
  east: DuelGameState['seats'][1];
  seat: DuelGameState['seats'][0];
  onToggleToken: (index: number) => void;
  onBuyPyramid: (card: DuelJewelCard, level: 1 | 2 | 3) => void;
  onReservePyramid: (card: DuelJewelCard, level: 1 | 2 | 3) => void;
  onReserveDeck: (level: 1 | 2 | 3) => void;
  buyReserved: (cardId: string) => void;
}) {
  const { t } = useI18n();
  const chrome = usePracticeChromeOptional();

  /** Seat that owns chrome + take controls ("my seat"). */
  const controlsSeatId =
    setup.mode === 'hotseat'
      ? state.currentSeat
      : (state.seats.find((s) => s.isHuman)?.id ?? 0);

  const seatFooter = (seatId: number) => {
    if (seatId !== controlsSeatId) return undefined;
    return (
      <div className="flex flex-col gap-1.5 pt-1 border-t border-splendor-line/40">
        {chrome && (
          <button
            type="button"
            onClick={chrome.toggleChrome}
            aria-expanded={chrome.chromeOpen}
            className="btn-outline text-xs w-full"
          >
            {chrome.chromeOpen
              ? t('practiceHideChrome')
              : t('practiceShowChrome')}
          </button>
        )}
        {humanActive && selectedIndices.length > 0 && (
          <>
            <button
              type="button"
              className="btn-primary text-xs w-full"
              onClick={confirmTake}
            >
              {t('duelConfirmTake', { n: selectedIndices.length })}
            </button>
            <button
              type="button"
              className="btn-outline text-xs w-full"
              onClick={() => setSelectedIndices([])}
            >
              {t('duelClearSelection')}
            </button>
          </>
        )}
        {humanActive &&
          !state.usedReplenishThisTurn &&
          state.bag.length > 0 &&
          (state.phase === 'optional' || state.phase === 'main') && (
            <button
              type="button"
              className="btn-outline text-xs w-full"
              onClick={() =>
                commit(applyAction(state, { type: 'replenish' }), state)
              }
            >
              {t('duelReplenish')}
            </button>
          )}
        {reserveGoldIndex !== null && (
          <p className="text-[11px] font-serif text-splendor-muted leading-snug">
            {t('duelReserveHint')}
          </p>
        )}
        {state.phase === 'chooseAssociate' && humanActive && (
          <div className="space-y-1">
            <p className="text-[11px] font-serif text-splendor-muted">
              {t('duelChooseAssociate')}
            </p>
            <div className="flex flex-wrap gap-1">
              {(
                ['emerald', 'sapphire', 'ruby', 'diamond', 'onyx'] as DuelGem[]
              )
                .filter((c) =>
                  seat.purchased.some((p) => p.effectiveBonus === c),
                )
                .map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="btn-outline text-xs"
                    onClick={() =>
                      commit(
                        applyAction(state, {
                          type: 'chooseAssociate',
                          color,
                        }),
                        state,
                      )
                    }
                  >
                    {color}
                  </button>
                ))}
            </div>
          </div>
        )}
        {state.phase === 'chooseSteal' && humanActive && (
          <div className="space-y-1">
            <p className="text-[11px] font-serif text-splendor-muted">
              {t('duelChooseSteal')}
            </p>
            <div className="flex flex-wrap gap-1">
              {listLegalActions(state)
                .filter((a) => a.type === 'chooseSteal')
                .map((a) =>
                  a.type === 'chooseSteal' ? (
                    <button
                      key={a.token}
                      type="button"
                      className="btn-outline text-xs"
                      onClick={() => commit(applyAction(state, a), state)}
                    >
                      {a.token}
                    </button>
                  ) : null,
                )}
            </div>
          </div>
        )}
        {state.phase === 'discardTokens' && humanActive && (
          <p className="text-[11px] font-serif text-splendor-velvet">
            {t('duelDiscardNeeded', { n: state.discardNeeded })}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {state.phase === 'aiBusy' && (
        <p className="text-sm font-serif text-splendor-muted text-center">
          {t('duelAiThinking')}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,14rem)] items-start">
        <DuelSeatPanel
          seat={west}
          active={state.currentSeat === 0 && state.phase !== 'done'}
          hideReserved={
            setup.mode === 'hotseat'
              ? state.currentSeat !== 0
              : !west.isHuman
          }
          discardMode={
            state.phase === 'discardTokens' && state.currentSeat === 0
          }
          onDiscard={(token: DuelToken) => {
            if (state.currentSeat !== 0) return;
            commit(
              applyAction(state, { type: 'discard', tokens: [token] }),
              state,
            );
          }}
          privilegeArmed={privilegeMode && state.currentSeat === 0}
          onUsePrivilege={
            humanActive && state.currentSeat === 0
              ? () => {
                  setPrivilegeMode((v) => !v);
                  setSelectedIndices([]);
                  setReserveGoldIndex(null);
                }
              : undefined
          }
          footer={seatFooter(0)}
        />

        <div className="min-w-0">
          <DuelBoard
            state={state}
            selectedIndices={selectedIndices}
            onToggleToken={onToggleToken}
            onBuyPyramid={onBuyPyramid}
            onReservePyramid={onReservePyramid}
            onReserveDeck={onReserveDeck}
            reserveGoldIndex={reserveGoldIndex}
            onPickGoldForReserve={(index) => {
              if (!humanActive) return;
              setPrivilegeMode(false);
              setSelectedIndices([]);
              setReserveGoldIndex((g) => (g === index ? null : index));
            }}
            onClaimRoyal={(royal) => {
              commit(
                applyAction(state, {
                  type: 'claimRoyal',
                  royalId: royal.id,
                }),
                state,
              );
            }}
            privilegeMode={privilegeMode}
            onPrivilegePick={(index) => {
              commit(
                applyAction(state, {
                  type: 'usePrivilege',
                  boardIndex: index,
                }),
                state,
              );
            }}
            takeMatchingColor={
              state.phase === 'chooseTakeMatching'
                ? state.pendingTakeMatchingColor
                : null
            }
            onTakeMatching={(index) => {
              commit(
                applyAction(state, {
                  type: 'chooseTakeMatching',
                  boardIndex: index,
                }),
                state,
              );
            }}
          />

          {humanActive && seat.reserved.length > 0 && (
            <div className="mt-3 panel p-3">
              <p className="text-xs font-serif text-splendor-muted mb-2">
                {t('duelReserved')}
              </p>
              <div className="flex flex-wrap gap-2">
                {seat.reserved.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`btn-outline text-xs ${
                      canAffordDuelCard(c, seat.hand, seat.bonuses)
                        ? 'border-splendor-gold/60'
                        : ''
                    }`}
                    disabled={
                      !canAffordDuelCard(c, seat.hand, seat.bonuses)
                    }
                    onClick={() => buyReserved(c.id)}
                  >
                    L{c.level} · {c.prestige}pt · {t('soloCanBuy')}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <DuelSeatPanel
          seat={east}
          active={state.currentSeat === 1 && state.phase !== 'done'}
          hideReserved={
            setup.mode === 'hotseat'
              ? state.currentSeat !== 1
              : !east.isHuman
          }
          discardMode={
            state.phase === 'discardTokens' && state.currentSeat === 1
          }
          onDiscard={(token: DuelToken) => {
            if (state.currentSeat !== 1) return;
            commit(
              applyAction(state, { type: 'discard', tokens: [token] }),
              state,
            );
          }}
          privilegeArmed={privilegeMode && state.currentSeat === 1}
          onUsePrivilege={
            humanActive && state.currentSeat === 1
              ? () => {
                  setPrivilegeMode((v) => !v);
                  setSelectedIndices([]);
                  setReserveGoldIndex(null);
                }
              : undefined
          }
          footer={seatFooter(1)}
        />
      </div>
    </div>
  );
}
