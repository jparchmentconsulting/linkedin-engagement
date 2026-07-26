"use client";

import { useSyncExternalStore } from "react";

// Formats a timestamp in the viewer's own locale and timezone. The server
// renders an en-US fallback so hydration matches, then the
// browser re-renders it in the viewer's own locale. useSyncExternalStore is
// the hydration-safe "am I on the client yet" signal — no effect-and-setState
// hop, which the react-hooks lint rightly flags.

const emptySubscribe = () => () => {};
function useHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

const defaultOptions: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "long",
  day: "numeric",
};

export default function LocalDate({
  iso,
  options = defaultOptions,
}: {
  /** ISO timestamp; omit for "now". */
  iso?: string;
  options?: Intl.DateTimeFormatOptions;
}) {
  const hydrated = useHydrated();
  const date = iso ? new Date(iso) : new Date();
  return <>{date.toLocaleDateString(hydrated ? undefined : "en-US", options)}</>;
}
