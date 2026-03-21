import { StoreApi, UseBoundStore } from 'zustand';

type WithSelectors<S> = S extends { getState: () => infer T }
  ? S & { use: { [K in keyof T]: () => T[K] } }
  : never;

/**
 * Auto-generates individual selector hooks for each state property and action.
 *
 * Usage:
 *   const useStore = createSelectors(useStoreBase);
 *   const bears = useStore.use.bears();        // subscribes only to bears
 *   const increment = useStore.use.increment(); // stable action reference
 *
 * The original store hook still works as before — this is purely additive.
 */
export const createSelectors = <S extends UseBoundStore<StoreApi<object>>>(
  _store: S
) => {
  const store = _store as WithSelectors<typeof _store>;
  store.use = {} as Record<string, () => unknown>;
  for (const k of Object.keys(store.getState())) {
    (store.use as Record<string, () => unknown>)[k] = () =>
      store((s) => s[k as keyof typeof s]);
  }
  return store;
};
