import { describe, expect, it } from 'vitest';
import { createStore, toRaw } from './store';

const tick = () => new Promise(r => queueMicrotask(() => r(null)));

describe('store', () => {
  it('notifies once per tick for writes at any depth, and not for no-op writes', async () => {
    const { state, subscribe } = createStore({ a: 1, list: [{ n: 1 }], o: { x: 'y' } as Record<string, string> });
    let calls = 0;
    subscribe(() => calls++);
    state.a = 2;
    state.list[0].n = 5;
    state.list.push({ n: 2 });
    await tick();
    expect(calls).toBe(1);
    state.a = 2;
    await tick();
    expect(calls).toBe(1);
    delete state.o.x;
    await tick();
    expect(calls).toBe(2);
  });

  it('stores raw values, so structuredClone works on what it hands out', () => {
    const { state } = createStore({ draft: null as { cells: number[] } | null });
    state.draft = { cells: [1] };
    state.draft = { cells: [...state.draft.cells, 2] };
    expect(structuredClone(toRaw(state.draft))).toEqual({ cells: [1, 2] });
    expect(() => structuredClone(toRaw(state.draft!.cells))).not.toThrow();
    // a new literal built from store values holds watchers until toRaw, and none once stored
    const mixed = { cells: state.draft!.cells, more: [state.draft] };
    expect(() => structuredClone(toRaw(mixed))).not.toThrow();
    state.draft = { cells: [...state.draft!.cells] };
    (state as { list?: unknown }).list = [state.draft];
    expect(() => structuredClone(toRaw(state))).not.toThrow();
  });

  it('leaves frozen objects and class instances alone', () => {
    class Box { v = 1 }
    const frozen = Object.freeze({ props: { a: 1 } });
    const { state } = createStore({ box: new Box(), frozen });
    expect(state.box).toBeInstanceOf(Box);
    expect(state.frozen).toBe(frozen);
  });
});
