// State that lives outside React: it survives unmounts (a battle, a trip to the game menu) and redraws its readers by itself.
// Change it in place, at any depth: every write marks it changed, and readers redraw once per tick.
import { useSyncExternalStore } from 'react';

const RAW = Symbol('raw');

/** Only plain data is watched; class instances, DOM nodes and React elements pass through untouched. */
const watchable = (o: unknown): o is object =>
  typeof o === 'object' && o !== null && !Object.isFrozen(o) && !('$$typeof' in o)
  && (Array.isArray(o) || Object.getPrototypeOf(o) === Object.prototype);

/**
 * The plain data behind a store value, with no watcher left at any depth: what structuredClone needs.
 * Plain values that hold no watcher come back as they are; the store keeps everything in this form.
 */
export function toRaw<T>(v: T): T {
  const raw = (v as { [RAW]?: T } | null)?.[RAW];
  if (raw) return raw;
  if (!watchable(v)) return v;
  let out = v as Record<string, unknown>;
  for (const [k, x] of Object.entries(v)) {
    const r = toRaw(x);
    if (r === x) continue;
    if (out === v) out = (Array.isArray(v) ? [...v] : { ...v }) as Record<string, unknown>;
    out[k] = r;
  }
  return out as T;
}

export function createStore<T extends object>(initial: T) {
  const subs = new Set<() => void>();
  let version = 0, queued = false;
  const changed = () => {
    version++;
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; subs.forEach(f => f()); });
  };

  const proxies = new WeakMap<object, object>();
  const wrap = <V>(o: V): V => {
    if (!watchable(o)) return o;
    let p = proxies.get(o);
    if (!p) proxies.set(o, p = new Proxy(o, {
      get: (t, k) => k === RAW ? t : wrap(Reflect.get(t, k)),
      set: (t, k, v) => {
        const raw = toRaw(v);
        if (Object.is(Reflect.get(t, k), raw)) return true;
        Reflect.set(t, k, raw);
        changed();
        return true;
      },
      deleteProperty: (t, k) => {
        if (!Reflect.has(t, k)) return true;
        Reflect.deleteProperty(t, k);
        changed();
        return true;
      },
    }));
    return p as V;
  };

  const subscribe = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn); }; };
  return {
    state: wrap(initial),
    subscribe,
    /** Redraws the calling component after every change. */
    useStore: () => { useSyncExternalStore(subscribe, () => version); },
  };
}
