"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/*
 * Enter animations must not run on the server-rendered first paint: the SSR
 * HTML would carry `opacity: 0` and the content would stay invisible (then
 * flash) until hydration. So components play their mount animation only when
 * they mount after the app has hydrated: client navigations, newly inserted
 * list items, opened panels. During hydration React uses the server snapshot
 * (`false`), so server and client markup always match and there are no
 * hydration warnings.
 */
let hydrated = false;
const noopSubscribe = () => () => {};

/** True when this component mounted after the initial hydration and may therefore play an enter animation. */
export function useCanAnimateMount(): boolean {
  const canAnimate = useSyncExternalStore(
    noopSubscribe,
    () => hydrated,
    () => false,
  );
  useEffect(() => {
    hydrated = true;
  }, []);
  return canAnimate;
}

/** False on the first render (server and hydration), true after the component's first effect. */
export function useHasMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // One extra render after mount is the point of this hook.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);
  return mounted;
}

/** Test helper: mark the app as hydrated (or not) so mount animations can be exercised in jsdom. */
export function setHydratedForTests(value: boolean): void {
  hydrated = value;
}
