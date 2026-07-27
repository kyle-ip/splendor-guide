import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { gems } from '@/lib/assets';
import type { SoloCard } from '@/data/solo-cards';
import { prefersReducedMotion } from './CeremonyFx';

export type PurchaseBuyer = 'player' | 'automa' | 'ai';

export type MarketPhase = 'lift' | 'exit';

const LIFT_MS = 200;
const EXIT_MS = 500;
const SETTLE_MS = 400;
const REDUCED_MS = 40;

type ExitFx = { cardId: string; buyer: PurchaseBuyer; phase: MarketPhase };

type Burst = { id: number; x: number; y: number; src: string };

type PurchaseFxApi = {
  run: (cardId: string, buyer: PurchaseBuyer, onDone: () => void) => void;
  isExiting: (cardId: string) => boolean;
  isLifting: (cardId: string) => boolean;
  isLanding: (cardId: string) => boolean;
  exitBuyer: PurchaseBuyer | null;
  marketPhase: MarketPhase | null;
  isAnimating: boolean;
};

const PurchaseFxContext = createContext<PurchaseFxApi | null>(null);

function snapshotMarket(): Map<string, DOMRect> {
  const map = new Map<string, DOMRect>();
  document.querySelectorAll<HTMLElement>('[data-solo-card]').forEach((el) => {
    const id = el.getAttribute('data-solo-card');
    if (!id) return;
    map.set(id, el.getBoundingClientRect());
  });
  return map;
}

function applyFlipSettle(snap: Map<string, DOMRect>): string[] {
  const landing: string[] = [];
  const flips: { el: HTMLElement; dx: number; dy: number }[] = [];

  document.querySelectorAll<HTMLElement>('[data-solo-card]').forEach((el) => {
    const id = el.getAttribute('data-solo-card');
    if (!id) return;
    const first = snap.get(id);
    if (!first) {
      landing.push(id);
      // Hide until card-deal-in is applied (inline opacity cleared after paint).
      el.style.opacity = '0';
      return;
    }
    const last = el.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      flips.push({ el, dx, dy });
    }
  });

  for (const { el, dx, dy } of flips) {
    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      for (const { el } of flips) {
        el.classList.add('card-slot-slide');
        el.style.transform = '';
      }
      window.setTimeout(() => {
        for (const { el } of flips) {
          el.classList.remove('card-slot-slide');
          el.style.transition = '';
        }
      }, SETTLE_MS);
    });
  });

  return landing;
}

function sparkleAtCard(
  cardId: string,
  bonusSrc: string,
  addBurst: (b: Burst) => void,
) {
  const el = document.querySelector(`[data-solo-card="${cardId}"]`);
  if (!el) return;
  const rect = el.getBoundingClientRect();
  addBurst({
    id: Date.now(),
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    src: bonusSrc,
  });
}

export function PurchaseFxProvider({ children }: { children: ReactNode }) {
  const [exitFx, setExitFx] = useState<ExitFx | null>(null);
  const [landingIds, setLandingIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const idRef = useRef(0);
  const pendingSnapRef = useRef<Map<string, DOMRect> | null>(null);
  const timersRef = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
  }, []);

  const schedule = useCallback((fn: () => void, ms: number) => {
    const t = window.setTimeout(fn, ms);
    timersRef.current.push(t);
    return t;
  }, []);

  const finishBusy = useCallback(() => {
    setLandingIds([]);
    setBusy(false);
    pendingSnapRef.current = null;
  }, []);

  const addBurst = useCallback((partial: Omit<Burst, 'id'>) => {
    const id = ++idRef.current;
    setBursts((b) => [...b, { ...partial, id }]);
    window.setTimeout(() => {
      setBursts((b) => b.filter((x) => x.id !== id));
    }, 700);
  }, []);

  const run = useCallback(
    (cardId: string, buyer: PurchaseBuyer, onDone: () => void) => {
      if (busy) return;
      clearTimers();
      setBusy(true);

      if (prefersReducedMotion()) {
        pendingSnapRef.current = null;
        schedule(() => {
          onDone();
          finishBusy();
        }, REDUCED_MS);
        return;
      }

      pendingSnapRef.current = snapshotMarket();

      const bonusEl = document.querySelector(
        `[data-solo-card="${cardId}"] [data-solo-card-bonus]`,
      ) as HTMLImageElement | null;
      sparkleAtCard(cardId, bonusEl?.src ?? gems.gold, addBurst);

      setLandingIds([]);
      setExitFx({ cardId, buyer, phase: 'lift' });

      schedule(() => {
        setExitFx({ cardId, buyer, phase: 'exit' });
      }, LIFT_MS);

      schedule(() => {
        setExitFx(null);
        onDone();
        // Wait for React to commit the refilled market, then FLIP + deal-in.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const snap = pendingSnapRef.current;
            pendingSnapRef.current = null;
            if (!snap) {
              finishBusy();
              return;
            }
            const landing = applyFlipSettle(snap);
            setLandingIds(landing);
            // After React paints card-deal-in, drop the inline hide so the
            // keyframe can drive opacity.
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                for (const id of landing) {
                  const el = document.querySelector<HTMLElement>(
                    `[data-solo-card="${id}"]`,
                  );
                  if (el) el.style.opacity = '';
                }
              });
            });
            schedule(() => {
              finishBusy();
            }, SETTLE_MS);
          });
        });
      }, LIFT_MS + EXIT_MS);
    },
    [busy, addBurst, clearTimers, schedule, finishBusy],
  );

  const isExiting = useCallback(
    (cardId: string) =>
      exitFx?.cardId === cardId && exitFx.phase === 'exit',
    [exitFx],
  );

  const isLifting = useCallback(
    (cardId: string) =>
      exitFx?.cardId === cardId && exitFx.phase === 'lift',
    [exitFx],
  );

  const isLanding = useCallback(
    (cardId: string) => landingIds.includes(cardId),
    [landingIds],
  );

  const api = useMemo(
    () => ({
      run,
      isExiting,
      isLifting,
      isLanding,
      exitBuyer: exitFx?.buyer ?? null,
      marketPhase: exitFx?.phase ?? null,
      isAnimating: busy || exitFx !== null || landingIds.length > 0,
    }),
    [run, isExiting, isLifting, isLanding, exitFx, busy, landingIds],
  );

  return (
    <PurchaseFxContext.Provider value={api}>
      {children}
      {createPortal(
        <>
          {bursts.map((b) => (
            <div
              key={b.id}
              className="drag-sparkle-burst"
              style={{ left: b.x, top: b.y }}
            >
              {Array.from({ length: 8 }).map((_, i) => (
                <span
                  key={i}
                  className="drag-sparkle-bit"
                  style={{
                    ['--a' as string]: `${i * 45}deg`,
                    backgroundImage: `url(${b.src})`,
                  }}
                />
              ))}
            </div>
          ))}
        </>,
        document.body,
      )}
    </PurchaseFxContext.Provider>
  );
}

export function usePurchaseFx(): PurchaseFxApi {
  const ctx = useContext(PurchaseFxContext);
  if (!ctx) {
    throw new Error('usePurchaseFx must be used within PurchaseFxProvider');
  }
  return ctx;
}

export function usePurchaseFxOptional(): PurchaseFxApi | null {
  return useContext(PurchaseFxContext);
}

/** Run purchase animation when provider exists; otherwise apply immediately. */
export function runPurchaseAnimated(
  fx: PurchaseFxApi | null,
  card: SoloCard,
  buyer: PurchaseBuyer,
  onDone: () => void,
) {
  if (fx) {
    fx.run(card.id, buyer, onDone);
  } else {
    onDone();
  }
}

export { LIFT_MS, EXIT_MS, SETTLE_MS };
