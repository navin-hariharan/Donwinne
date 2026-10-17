import { useEffect, useSyncExternalStore } from "react";

/**
 * Screen classes the layout switches between.
 * - phone: narrow portrait screens. Tools in a bottom bar, properties in a bottom sheet.
 * - short: landscape phones and very low windows (checked first, so a 568x320 phone on its side is "short"). Slim tool rail, properties in a drawer.
 * - tablet: medium widths. Slim tool rail, properties in a drawer, menus behind one button.
 * - desktop: the full layout with the docked properties panel.
 */
export type ScreenClass = "phone" | "short" | "tablet" | "desktop";

export const PHONE_MAX_W = 599;
export const SHORT_MAX_H = 499;
export const TABLET_MAX_W = 1023;

export function screenClassFor(w: number, h: number): ScreenClass {
  if (h <= SHORT_MAX_H && w > h) return "short";
  if (w <= PHONE_MAX_W) return "phone";
  if (h <= SHORT_MAX_H) return "short";
  if (w <= TABLET_MAX_W) return "tablet";
  return "desktop";
}

function currentScreen(): ScreenClass {
  if (typeof window === "undefined") return "desktop";
  return screenClassFor(window.innerWidth, window.innerHeight);
}

function subscribeResize(cb: () => void) {
  window.addEventListener("resize", cb);
  window.addEventListener("orientationchange", cb);
  return () => {
    window.removeEventListener("resize", cb);
    window.removeEventListener("orientationchange", cb);
  };
}

export function useScreenClass(): ScreenClass {
  return useSyncExternalStore(subscribeResize, currentScreen, () => "desktop");
}

/** Whether the properties panel sits beside the canvas (true) or slides over it (false). */
export const propsDocked = (s: ScreenClass) => s === "desktop";

export function matches(query: string): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
      const mq = window.matchMedia(query);
      // Safari before 14 only has addListener.
      if (mq.addEventListener) mq.addEventListener("change", cb);
      else mq.addListener(cb);
      return () => (mq.removeEventListener ? mq.removeEventListener("change", cb) : mq.removeListener(cb));
    },
    () => matches(query),
    () => false,
  );
}

/** True when the main pointer is a finger: hit targets grow and hover hints give way to touch hints. */
export const useCoarsePointer = () => useMedia("(pointer: coarse)");

export const prefersReducedMotion = () => matches("(prefers-reduced-motion: reduce)");

/**
 * Keeps the app the size of the visible area. On phones the on-screen keyboard shrinks the visual
 * viewport but (on iOS) not the layout viewport, so without this a focused field can end up under
 * the keyboard. Sets --app-h and --app-top on the root element.
 */
export function useVisualViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Ignore pinch zoom: only the keyboard and browser bars should resize the app.
        if (Math.abs(vv.scale - 1) > 0.01) return;
        const full = Math.abs(window.innerHeight - vv.height) < 1 && vv.offsetTop === 0;
        if (full) {
          root.style.removeProperty("--app-h");
          root.style.removeProperty("--app-top");
        } else {
          root.style.setProperty("--app-h", `${Math.round(vv.height)}px`);
          root.style.setProperty("--app-top", `${Math.round(vv.offsetTop)}px`);
        }
        // The page itself never scrolls; undo a scroll the browser made to reveal a field.
        if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
      });
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
}
