import type { DuelJewelCard, DuelRoyalCard, DuelToken, DuelGem } from '@/data/duel-cards';
import {
  canAffordDuelCard,
  remainingCost,
  type OwnedDuelCard,
} from '@/data/duel-cards';
import { gems } from '@/lib/assets';
import { useI18n } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/messages';
import type { DuelGameState } from './types';
import { BOARD_DIM } from './engine';
import { usePurchaseFxOptional } from '@/features/solo/PurchaseFx';

const LEVEL_BAND: Record<1 | 2 | 3, string> = {
  1: 'bg-[#6b8f78]',
  2: 'bg-[#c4a96a]',
  3: 'bg-[#6a8098]',
};

const TOKEN_IMG: Record<DuelToken, string> = {
  emerald: gems.emerald,
  sapphire: gems.sapphire,
  ruby: gems.ruby,
  diamond: gems.diamond,
  onyx: gems.onyx,
  gold: gems.gold,
  pearl: gems.pearl,
};

const ABILITY_KEY: Record<
  Exclude<NonNullable<DuelJewelCard['ability']>, null>,
  MessageKey
> = {
  extraTurn: 'duelAbility_extraTurn',
  takeMatching: 'duelAbility_takeMatching',
  privilege: 'duelAbility_privilege',
  steal: 'duelAbility_steal',
};

export function tokenLabel(
  t: (k: MessageKey) => string,
  token: DuelToken,
): string {
  if (token === 'pearl') return t('duelPearl');
  if (token === 'emerald') return t('gemEmerald');
  if (token === 'sapphire') return t('gemSapphire');
  if (token === 'ruby') return t('gemRuby');
  if (token === 'diamond') return t('gemDiamond');
  if (token === 'onyx') return t('gemOnyx');
  return t('gemGold');
}

export function DuelJewelTile({
  card,
  onClick,
  affordable,
  bonuses,
}: {
  card: DuelJewelCard;
  onClick?: () => void;
  affordable?: boolean;
  bonuses?: Record<DuelGem, number>;
}) {
  const { t } = useI18n();
  const need = bonuses ? remainingCost(card, bonuses) : card.cost;
  const costKeys = (
    ['emerald', 'sapphire', 'ruby', 'diamond', 'onyx', 'pearl'] as const
  ).filter((k) => need[k] > 0);

  const ringClass = affordable
    ? 'border-splendor-gold/80 shadow-[0_2px_8px_rgba(154,123,50,0.2),0_0_0_1px_rgba(154,123,50,0.35)] hover:scale-[1.01]'
    : '';

  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={onClick}
      onMouseDown={(e) => {
        if (onClick) e.preventDefault();
      }}
      className={`solo-card-tile solo-card-face relative text-left pt-3.5 p-2 sm:pt-4 sm:p-2.5 bg-[var(--board-ivory)] flex flex-col overflow-hidden rounded-sm transition-[border-color,box-shadow,transform] border border-splendor-ink/30 shadow-[0_1px_4px_rgba(44,36,28,0.08)] ${ringClass} ${
        onClick ? 'cursor-pointer' : 'cursor-default'
      }`}
    >
      <span
        className={`absolute inset-x-0 top-0 h-2.5 ${LEVEL_BAND[card.level]}`}
        aria-hidden
      />
      <div className="flex justify-between items-start gap-1 mb-1 min-h-0 shrink">
        <span className="font-display text-lg sm:text-xl text-splendor-velvet leading-none tabular-nums font-semibold tracking-woodcut">
          {card.prestige || '\u00a0'}
        </span>
        <span className="inline-flex items-center gap-0.5 shrink-0">
          {card.crowns > 0 && (
            <span
              className="text-xs font-serif text-splendor-gold"
              title={t('duelCrowns')}
            >
              {'♛'.repeat(Math.min(card.crowns, 3))}
            </span>
          )}
          {card.bonus === 'associate' ? (
            <span className="text-[11px] font-serif text-splendor-muted">
              {t('duelAssociate')}
            </span>
          ) : card.bonus ? (
            <span className="inline-flex items-center gap-0.5">
              {Array.from({ length: card.bonusCount || 1 }).map((_, i) => (
                <img
                  key={i}
                  src={TOKEN_IMG[card.bonus as DuelGem]}
                  alt=""
                  className="w-5 h-5 sm:w-6 sm:h-6 object-contain"
                />
              ))}
            </span>
          ) : null}
        </span>
      </div>
      {card.ability && (
        <p className="text-[11px] sm:text-xs font-serif text-splendor-muted mb-1 leading-tight">
          {t(ABILITY_KEY[card.ability])}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5 mt-auto">
        {costKeys.map((k) => (
          <span
            key={k}
            className="inline-flex items-center gap-0.5 text-xs sm:text-sm font-serif font-medium tabular-nums leading-none"
          >
            <img
              src={TOKEN_IMG[k]}
              alt=""
              className="w-4 h-4 sm:w-[1.125rem] sm:h-[1.125rem] object-contain shrink-0"
            />
            {need[k]}
          </span>
        ))}
      </div>
    </button>
  );
}

function DeckBack({
  level,
  count,
  onClick,
}: {
  level: 1 | 2 | 3;
  count: number;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!onClick || count === 0}
      onClick={onClick}
      className={`solo-card-face shrink-0 border border-splendor-ink/40 rounded-sm flex flex-col items-center justify-center ${LEVEL_BAND[level]} text-white/90 ${
        onClick && count > 0
          ? 'cursor-pointer opacity-90 hover:opacity-100'
          : 'opacity-50'
      }`}
      style={{ width: 'calc(var(--duel-card-max-h) * 63 / 88)' }}
    >
      <span className="font-display text-base sm:text-lg">{level}</span>
      <span className="text-xs font-serif tabular-nums">{count}</span>
    </button>
  );
}

export function DuelBoard({
  state,
  selectedIndices,
  onToggleToken,
  onBuyPyramid,
  onReservePyramid,
  onReserveDeck,
  onPickGoldForReserve,
  reserveGoldIndex,
  onClaimRoyal,
  onPrivilegePick,
  privilegeMode,
  onTakeMatching,
  takeMatchingColor,
}: {
  state: DuelGameState;
  selectedIndices: number[];
  onToggleToken: (index: number) => void;
  onBuyPyramid: (card: DuelJewelCard, level: 1 | 2 | 3) => void;
  onReservePyramid: (card: DuelJewelCard, level: 1 | 2 | 3) => void;
  onReserveDeck: (level: 1 | 2 | 3) => void;
  onPickGoldForReserve: (index: number) => void;
  reserveGoldIndex: number | null;
  onClaimRoyal: (royal: DuelRoyalCard) => void;
  onPrivilegePick: (index: number) => void;
  privilegeMode: boolean;
  onTakeMatching: (index: number) => void;
  takeMatchingColor: DuelGem | null;
}) {
  const { t } = useI18n();
  const purchaseFx = usePurchaseFxOptional();
  const seat = state.seats[state.currentSeat];
  const canAct =
    seat.isHuman &&
    !purchaseFx?.isAnimating &&
    (state.phase === 'optional' ||
      state.phase === 'main' ||
      state.phase === 'chooseRoyal' ||
      state.phase === 'chooseTakeMatching');

  const renderRow = (
    level: 1 | 2 | 3,
    row: (DuelJewelCard | null)[],
    deckCount: number,
  ) => (
    <div
      className="duel-card-row"
      style={{ ['--duel-card-slots' as string]: row.length + 1 }}
    >
      <DeckBack
        level={level}
        count={deckCount}
        onClick={
          canAct && reserveGoldIndex !== null && deckCount > 0
            ? () => onReserveDeck(level)
            : undefined
        }
      />
      {row.map((card, i) =>
        card ? (
          <div key={card.id} className="min-w-0">
            <div
              data-solo-card={card.id}
              className={`relative w-full ${
                purchaseFx?.isLifting(card.id)
                  ? 'card-market-lift'
                  : purchaseFx?.isExiting(card.id) && purchaseFx.exitBuyer
                    ? `card-purchase-exit card-purchase-exit--${purchaseFx.exitBuyer}`
                    : purchaseFx?.isLanding(card.id)
                      ? 'card-deal-in'
                      : ''
              }`}
            >
              <DuelJewelTile
                card={card}
                bonuses={seat.bonuses}
                affordable={
                  canAct &&
                  canAffordDuelCard(card, seat.hand, seat.bonuses) &&
                  reserveGoldIndex === null
                }
                onClick={
                  canAct
                    ? () => {
                        if (reserveGoldIndex !== null) {
                          onReservePyramid(card, level);
                        } else if (
                          canAffordDuelCard(card, seat.hand, seat.bonuses)
                        ) {
                          onBuyPyramid(card, level);
                        }
                      }
                    : undefined
                }
              />
            </div>
          </div>
        ) : (
          <div
            key={`empty-${level}-${i}`}
            className="solo-card-face border border-dashed border-splendor-line/50 rounded-sm card-slot-refill"
          />
        ),
      )}
    </div>
  );

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="text-center border border-splendor-line/60 bg-white/50 px-3 py-2">
        <p className="text-xs font-serif text-splendor-muted tracking-wide mb-1">
          {t('duelVictoryTile')}
        </p>
        <p className="text-sm font-serif text-splendor-ink">
          {t('duelVictoryHint')}
        </p>
      </div>

      <div className="space-y-2.5 sm:space-y-3">
        {renderRow(3, state.l3, state.d3.length)}
        {renderRow(2, state.l2, state.d2.length)}
        {renderRow(1, state.l1, state.d1.length)}
      </div>

      <div className="flex items-center justify-center gap-2 flex-wrap">
        <span className="text-xs font-serif text-splendor-muted">
          {t('duelPrivilegesSupply')}
        </span>
        {Array.from({ length: 3 }).map((_, i) => (
          <span
            key={i}
            className={`w-8 h-8 rounded-sm border text-xs font-serif flex items-center justify-center ${
              i < state.privilegesSupply
                ? 'border-splendor-gold/70 bg-splendor-gold/15 text-splendor-velvet'
                : 'border-splendor-line/40 opacity-35'
            }`}
          >
            P
          </span>
        ))}
        <span className="text-xs font-serif text-splendor-muted ml-2">
          {t('duelBag')}: {state.bag.length}
        </span>
      </div>

      <div
        className="mx-auto grid gap-1.5 sm:gap-2 p-2.5 sm:p-3 border border-splendor-ink/25 bg-[var(--board-ivory)]/80 rounded-sm"
        style={{
          gridTemplateColumns: `repeat(${BOARD_DIM}, minmax(0, 3.25rem))`,
          width: 'max-content',
          maxWidth: '100%',
        }}
      >
        {state.board.map((token, index) => {
          const selected = selectedIndices.includes(index);
          const matching =
            takeMatchingColor && token === takeMatchingColor;
          const privilegePick =
            privilegeMode && token && token !== 'gold';
          const clickable =
            canAct &&
            token &&
            (privilegeMode
              ? privilegePick
              : takeMatchingColor
                ? matching
                : true);

          return (
            <button
              key={index}
              type="button"
              disabled={!token || !clickable}
              onClick={() => {
                if (!token || !canAct) return;
                if (privilegeMode && token !== 'gold') {
                  onPrivilegePick(index);
                  return;
                }
                if (takeMatchingColor && token === takeMatchingColor) {
                  onTakeMatching(index);
                  return;
                }
                if (token === 'gold') {
                  onPickGoldForReserve(index);
                  return;
                }
                onToggleToken(index);
              }}
              className={`aspect-square w-12 sm:w-[3.25rem] flex items-center justify-center border rounded-sm ${
                selected
                  ? 'border-splendor-gold bg-splendor-gold/20 ring-1 ring-splendor-gold/50'
                  : reserveGoldIndex === index
                    ? 'border-gem-emerald bg-gem-emerald/15'
                    : matching
                      ? 'border-splendor-velvet/60 bg-splendor-velvet/10'
                      : 'border-splendor-line/50 bg-white/70'
              } ${!token ? 'opacity-30' : ''}`}
              title={token ? tokenLabel(t, token) : ''}
            >
              {token ? (
                <img
                  src={TOKEN_IMG[token]}
                  alt={token}
                  className="w-9 h-9 sm:w-10 sm:h-10 object-contain drop-shadow-[0_2px_3px_rgba(44,36,28,0.35)]"
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        <span className="text-xs font-serif text-splendor-muted self-center">
          {t('duelRoyals')}
        </span>
        {state.royals.map((r) => (
          <button
            key={r.id}
            type="button"
            disabled={state.phase !== 'chooseRoyal' || !seat.isHuman}
            onClick={() => onClaimRoyal(r)}
            className={`px-2 py-1.5 border text-left text-xs font-serif rounded-sm ${
              state.phase === 'chooseRoyal'
                ? 'border-splendor-gold/70 bg-splendor-gold/10 cursor-pointer'
                : 'border-splendor-line/50 bg-white/60'
            }`}
          >
            <span className="font-display text-splendor-velvet">
              {r.prestige}
            </span>
            {r.ability ? (
              <span className="block text-splendor-muted">
                {t(ABILITY_KEY[r.ability])}
              </span>
            ) : (
              <span className="block text-splendor-muted">
                {t('duelPrestigeOnly')}
              </span>
            )}
          </button>
        ))}
        {state.royals.length === 0 && (
          <span className="text-xs font-serif text-splendor-muted">—</span>
        )}
      </div>
    </div>
  );
}

export function OwnedCardsStrip({
  cards,
}: {
  cards: OwnedDuelCard[];
}) {
  const { t } = useI18n();
  if (cards.length === 0) {
    return (
      <p className="text-xs font-serif text-splendor-muted">{t('duelNoCards')}</p>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {cards.map((c) => (
        <span
          key={c.id}
          className="inline-flex items-center gap-1 px-1.5 py-1 border border-splendor-line/50 bg-white text-xs font-serif tabular-nums"
          title={c.id}
        >
          {c.effectiveBonus ? (
            <img
              src={TOKEN_IMG[c.effectiveBonus]}
              alt=""
              className="w-4 h-4"
            />
          ) : (
            <span>?</span>
          )}
          {c.prestige > 0 && <span>{c.prestige}</span>}
          {c.crowns > 0 && (
            <span className="text-splendor-gold">♛{c.crowns}</span>
          )}
        </span>
      ))}
    </div>
  );
}
