import { useCallback, useEffect, useRef, useState } from 'react';

const HISTORY_LIMIT = 50;
const SNAPSHOT_DEBOUNCE_MS = 300;

export interface PlanHistory<T> {
  state: T;
  setState: (next: T | ((current: T) => T)) => void;
  replaceState: (next: T) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  resetHistory: (value: T) => void;
}

export function usePlanHistory<T>(initial: T): PlanHistory<T> {
  const [state, setState] = useState<T>(initial);
  const pastRef = useRef<string[]>([]);
  const futureRef = useRef<string[]>([]);
  const lastSnapshotRef = useRef<string>(JSON.stringify(initial));
  const snapshotTimerRef = useRef<number | null>(null);
  const suspendSnapshotRef = useRef(false);
  const [, forceRender] = useState(0);

  const scheduleSnapshot = useCallback((prevSerialized: string) => {
    if (suspendSnapshotRef.current) return;
    if (snapshotTimerRef.current !== null) {
      window.clearTimeout(snapshotTimerRef.current);
    }
    snapshotTimerRef.current = window.setTimeout(() => {
      snapshotTimerRef.current = null;
      if (prevSerialized !== lastSnapshotRef.current) return;
      pastRef.current = [...pastRef.current, prevSerialized].slice(-HISTORY_LIMIT);
      futureRef.current = [];
      forceRender((v) => v + 1);
    }, SNAPSHOT_DEBOUNCE_MS);
  }, []);

  const commitSnapshotImmediately = useCallback((prevSerialized: string) => {
    if (suspendSnapshotRef.current) return;
    if (snapshotTimerRef.current !== null) {
      window.clearTimeout(snapshotTimerRef.current);
      snapshotTimerRef.current = null;
    }
    pastRef.current = [...pastRef.current, prevSerialized].slice(-HISTORY_LIMIT);
    futureRef.current = [];
    forceRender((v) => v + 1);
  }, []);

  const setPlanState = useCallback(
    (next: T | ((current: T) => T)) => {
      setState((current) => {
        const resolved =
          typeof next === 'function' ? (next as (c: T) => T)(current) : next;
        const prevSerialized = lastSnapshotRef.current;
        const nextSerialized = JSON.stringify(resolved);
        if (nextSerialized === prevSerialized) return current;
        lastSnapshotRef.current = nextSerialized;
        scheduleSnapshot(prevSerialized);
        return resolved;
      });
    },
    [scheduleSnapshot]
  );

  const replaceState = useCallback(
    (next: T) => {
      const prevSerialized = lastSnapshotRef.current;
      const nextSerialized = JSON.stringify(next);
      if (nextSerialized === prevSerialized) return;
      lastSnapshotRef.current = nextSerialized;
      commitSnapshotImmediately(prevSerialized);
      setState(next);
    },
    [commitSnapshotImmediately]
  );

  const undo = useCallback(() => {
    if (snapshotTimerRef.current !== null) {
      window.clearTimeout(snapshotTimerRef.current);
      snapshotTimerRef.current = null;
    }
    const past = pastRef.current;
    if (past.length === 0) return;
    const previousSerialized = past[past.length - 1];
    pastRef.current = past.slice(0, -1);
    futureRef.current = [lastSnapshotRef.current, ...futureRef.current].slice(0, HISTORY_LIMIT);
    lastSnapshotRef.current = previousSerialized;
    suspendSnapshotRef.current = true;
    try {
      setState(JSON.parse(previousSerialized) as T);
    } finally {
      setTimeout(() => {
        suspendSnapshotRef.current = false;
      }, 0);
    }
  }, []);

  const redo = useCallback(() => {
    const future = futureRef.current;
    if (future.length === 0) return;
    const nextSerialized = future[0];
    futureRef.current = future.slice(1);
    pastRef.current = [...pastRef.current, lastSnapshotRef.current].slice(-HISTORY_LIMIT);
    lastSnapshotRef.current = nextSerialized;
    suspendSnapshotRef.current = true;
    try {
      setState(JSON.parse(nextSerialized) as T);
    } finally {
      setTimeout(() => {
        suspendSnapshotRef.current = false;
      }, 0);
    }
  }, []);

  const resetHistory = useCallback((value: T) => {
    pastRef.current = [];
    futureRef.current = [];
    if (snapshotTimerRef.current !== null) {
      window.clearTimeout(snapshotTimerRef.current);
      snapshotTimerRef.current = null;
    }
    lastSnapshotRef.current = JSON.stringify(value);
    setState(value);
  }, []);

  useEffect(() => {
    return () => {
      if (snapshotTimerRef.current !== null) {
        window.clearTimeout(snapshotTimerRef.current);
      }
    };
  }, []);

  return {
    state,
    setState: setPlanState,
    replaceState,
    undo,
    redo,
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
    resetHistory,
  };
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}
