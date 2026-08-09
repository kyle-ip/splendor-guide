const SCROLLING_CLASS = 'is-scrolling';
const HIDE_MS = 1200;

const hideTimers = new WeakMap<Element, number>();

function resolveScrollTargets(eventTarget: EventTarget | null): Element[] {
  if (eventTarget === document || eventTarget === document.documentElement) {
    return [document.documentElement, document.body].filter(Boolean);
  }
  if (eventTarget === document.body) {
    return [document.documentElement, document.body];
  }
  if (eventTarget instanceof Element) return [eventTarget];
  return [];
}

function revealScrollbar(el: Element) {
  el.classList.add(SCROLLING_CLASS);
  const prev = hideTimers.get(el);
  if (prev !== undefined) window.clearTimeout(prev);
  hideTimers.set(
    el,
    window.setTimeout(() => {
      el.classList.remove(SCROLLING_CLASS);
      hideTimers.delete(el);
    }, HIDE_MS),
  );
}

/** Theme scrollbars stay hidden until the user scrolls; then fade back out. */
export function initAutohideScrollbar() {
  const onScroll = (event: Event) => {
    for (const el of resolveScrollTargets(event.target)) {
      revealScrollbar(el);
    }
  };

  document.addEventListener('scroll', onScroll, { capture: true, passive: true });

  return () => {
    document.removeEventListener('scroll', onScroll, { capture: true });
  };
}
