import type { MaybePromise } from '../types/maybe-promise.js';
import type { Maybe } from '../types/maybe.js';
import type { ReadonlyDeep } from '../types/readonly-deep.js';
import { Deferred } from '../utils/deferred.js';
import { defined } from '../utils/defined.js';

type CacheState<K, V> =
  | { status: 'empty' }
  | { status: 'pending'; promise: Promise<ReadonlyMap<K, ReadonlyDeep<V>>> }
  | { status: 'resolved'; map: Map<K, V> };

type Inflight<K, V> =
  | { type: 'full'; promise: Promise<ReadonlyMap<K, ReadonlyDeep<V>>> }
  | { type: 'partial'; promise: Promise<ReadonlyMap<K, ReadonlyDeep<V>>> };

type ResolvedMap<K, V> = ReadonlyMap<K, ReadonlyDeep<V>>;

export type ProjectedMapOptions<K, V> = {
  /** Returns the key for an entity. */
  key: (item: V) => K;

  /**
   * Fetches values. Called with `undefined` for a full fetch, or a non-empty key array for
   * a partial fetch (never called with `[]`). For partial fetches, only entries whose key
   * is in the requested set are merged; any requested key missing from the result is deleted.
   */
  values: (keys: K[] | undefined) => MaybePromise<V[]>;

  /**
   * Optional sort applied on every materialization. Without it, full refresh keeps the
   * order returned by `values()`; partial refresh keeps existing positions and appends new keys.
   */
  sort?: Maybe<(a: V, b: V) => number>;

  /**
   * @default true
   */
  cache?: boolean;
};

/** Mirrors the Resolver default in dispatcher.ts. */
const PARTIAL_REFRESH_DEBOUNCE_MS = 50;

/**
 * In-memory collection backed by a remote source. Suits small collections that need to be
 * fetched and kept in sync.
 */
export class ProjectedMap<K, V> {
  private _state: CacheState<K, V> = { status: 'empty' };
  private readonly _key: (item: V) => K;
  private readonly _values: ProjectedMapOptions<K, V>['values'];
  private readonly _sort: Maybe<(a: V, b: V) => number>;
  private readonly _shouldCache: boolean;

  private _inflight: Inflight<K, V> | null = null;
  private _pendingFull = false;
  private _pendingPartial = new Set<K>();
  private _pendingDeferred: Deferred<ResolvedMap<K, V>> | null = null;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  // keys deleted during an in-flight refresh. The in-flight fetch may resurrect them with
  // stale data; tombstoned keys are dropped from the result and queued for a one-shot retry.
  private _tombstones = new Set<K>();

  constructor({ key, values, sort, cache }: ProjectedMapOptions<K, V>) {
    this._key = key;
    this._values = values;
    this._sort = sort;
    this._shouldCache = cache ?? true;
  }

  getAllAsMap(): MaybePromise<ResolvedMap<K, V>> {
    const cache = this.getCache();

    if (cache instanceof Promise) {
      return cache.then((map) => new Map(map));
    }

    return new Map(cache) as ResolvedMap<K, V>;
  }

  /**
   * Iteration order follows `sort` when configured, otherwise the order from the last full
   * `values()` call with partial-refresh additions appended.
   */
  getAll(): MaybePromise<ReadonlyArray<ReadonlyDeep<V>>> {
    const cache = this.getCache();

    if (cache instanceof Promise) {
      return cache.then((map) => [...map.values()]);
    }

    return [...cache.values()];
  }

  /** Returns one slot per requested key; missing keys become `undefined`. */
  getByKeysSparse(keys: readonly K[]): MaybePromise<ReadonlyArray<Maybe<ReadonlyDeep<V>>>> {
    if (keys.length === 0) {
      return [];
    }

    const cache = this.getCache();

    if (cache instanceof Promise) {
      return cache.then((map) => keys.map((id) => map.get(id)));
    }

    return keys.map((id) => cache.get(id));
  }

  getByKeys(keys: readonly K[]): MaybePromise<ReadonlyArray<ReadonlyDeep<V>>> {
    const sparse = this.getByKeysSparse(keys);

    if (sparse instanceof Promise) {
      return sparse.then((values) => values.filter(defined));
    }

    return sparse.filter(defined);
  }

  getByKey(key: K): MaybePromise<Maybe<ReadonlyDeep<V>>> {
    const cache = this.getCache();

    if (cache instanceof Promise) {
      return cache.then((map) => map.get(key));
    }

    return cache.get(key);
  }

  get(keyOrKeys: readonly K[]): MaybePromise<ReadonlyArray<ReadonlyDeep<V>>>;
  get(keyOrKeys: K): MaybePromise<Maybe<ReadonlyDeep<V>>>;
  get(keyOrKeys: K | readonly K[]): MaybePromise<ReadonlyArray<ReadonlyDeep<V>> | Maybe<ReadonlyDeep<V>>> {
    if (Array.isArray(keyOrKeys)) {
      return this.getByKeys(keyOrKeys as readonly K[]);
    }

    return this.getByKey(keyOrKeys as K);
  }

  /**
   * Deletes entries locally without fetching. No-op when not yet resolved. If a refresh
   * is in flight, the keys are tombstoned: the in-flight result drops them and a one-shot
   * retry confirms the post-delete state.
   */
  delete(keyOrKeys: K | K[]): void {
    if (this._state.status !== 'resolved') {
      return;
    }

    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];

    for (const key of keys) {
      this._state.map.delete(key);

      if (this._inflight !== null) {
        this._tombstones.add(key);
      }
    }
  }

  /** Clears cached values so the next access refetches. */
  clear() {
    this._state = { status: 'empty' };
  }

  refresh(): Promise<ResolvedMap<K, V>>;
  refresh(keyOrKeys: K | K[]): Promise<ResolvedMap<K, V>>;

  /**
   * Stale-while-revalidate refresh.
   *
   * - `refresh()` (or `refresh([])`) does a full re-fetch via `values(undefined)`.
   * - `refresh(key | keys)` does a partial re-fetch; requested keys missing from the result
   *   are deleted. Falls back to full when no resolved map exists yet.
   *
   * Concurrent calls coalesce: rapid partials within a debounce window merge into one fetch;
   * a full/partial requested while another is in flight is queued. A queued full subsumes
   * queued partial keys. Partial keys arriving during an in-flight full are not subsumed —
   * they run as a follow-up partial, since the full's snapshot may pre-date the change.
   *
   * On error, the stale map is preserved and the returned promise rejects.
   */
  refresh(keyOrKeys?: K | K[]): Promise<ResolvedMap<K, V>> {
    if (keyOrKeys === undefined) {
      return this.scheduleFull();
    }

    if (Array.isArray(keyOrKeys)) {
      if (keyOrKeys.length === 0) {
        return this.scheduleFull();
      }

      return this.schedulePartial(keyOrKeys);
    }

    return this.schedulePartial([keyOrKeys]);
  }

  private getCache(): MaybePromise<ResolvedMap<K, V>> {
    const state = this._state;

    if (state.status === 'resolved') {
      // safe: the underlying Map is only mutated internally; cast widens variance.
      return state.map as unknown as ResolvedMap<K, V>;
    }

    if (state.status === 'pending') {
      return state.promise;
    }

    return this.scheduleFull();
  }

  // ---------------------------------------------------------------------------
  // refresh state machine
  // ---------------------------------------------------------------------------

  private scheduleFull(): Promise<ResolvedMap<K, V>> {
    if (this._inflight?.type === 'full') {
      return this._inflight.promise;
    }

    if (this._inflight?.type === 'partial') {
      this._pendingFull = true;
      this._pendingPartial.clear();
      this.clearDebounce();

      return this.getOrCreatePendingDeferred().promise;
    }

    this.clearDebounce();
    this._pendingPartial.clear();
    this._pendingFull = false;

    return this.startFull();
  }

  private schedulePartial(keys: K[]): Promise<ResolvedMap<K, V>> {
    if (this._state.status !== 'resolved') {
      return this.scheduleFull();
    }

    // a queued full will refresh everything, so the partial is subsumed into it
    if (this._pendingFull) {
      return this.getOrCreatePendingDeferred().promise;
    }

    for (const key of keys) {
      this._pendingPartial.add(key);
    }

    const deferred = this.getOrCreatePendingDeferred();

    // drain runs the queued partial after the in-flight refresh completes
    if (this._inflight !== null) {
      return deferred.promise;
    }

    this.scheduleDebounce();

    return deferred.promise;
  }

  private scheduleDebounce(): void {
    if (this._debounceTimer !== null) {
      return;
    }

    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      this.drain();
    }, PARTIAL_REFRESH_DEBOUNCE_MS);
  }

  private clearDebounce(): void {
    if (this._debounceTimer !== null) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
  }

  private drain(): void {
    if (this._inflight !== null) {
      return;
    }

    if (this._pendingFull) {
      this._pendingFull = false;
      this._pendingPartial.clear();
      this.startFull();

      return;
    }

    if (this._pendingPartial.size > 0) {
      this.startPartial();
    }
  }

  private getOrCreatePendingDeferred(): Deferred<ResolvedMap<K, V>> {
    if (this._pendingDeferred === null) {
      this._pendingDeferred = new Deferred<ResolvedMap<K, V>>();
    }

    return this._pendingDeferred;
  }

  private startFull(): Promise<ResolvedMap<K, V>> {
    const deferred = this._pendingDeferred ?? new Deferred<ResolvedMap<K, V>>();

    this._pendingDeferred = null;

    const promise = Promise.resolve()
      // eslint-disable-next-line unicorn/no-useless-undefined
      .then(() => this._values(undefined))
      .then((array) => this.buildFullMap(array));

    this._inflight = { type: 'full', promise: deferred.promise };

    // transition to pending so concurrent gets join this fetch
    if (this._state.status === 'empty') {
      this._state = { status: 'pending', promise: deferred.promise };
    }

    promise.then(
      (map) => {
        this._state = this._shouldCache ? { status: 'resolved', map } : { status: 'empty' };

        // clear inflight + drain before resolving so awaiters observe the post-op state
        this._inflight = null;
        this.drain();

        deferred.resolve(map as unknown as ResolvedMap<K, V>);
      },
      (error) => {
        // keep stale on error; reset to empty if nothing was resolved yet
        if (this._state.status === 'pending') {
          this._state = { status: 'empty' };
        }

        this._tombstones.clear();

        this._inflight = null;
        this.drain();

        deferred.reject(error);
      },
    );

    return deferred.promise;
  }

  private startPartial(): Promise<ResolvedMap<K, V>> {
    const deferred = this._pendingDeferred ?? new Deferred<ResolvedMap<K, V>>();

    this._pendingDeferred = null;

    const keys = [...this._pendingPartial];

    this._pendingPartial.clear();

    const promise = Promise.resolve()
      .then(() => this._values(keys))
      .then((array) => this.mergePartial(keys, array));

    this._inflight = { type: 'partial', promise: deferred.promise };

    promise.then(
      (map) => {
        this._inflight = null;
        this.drain();

        deferred.resolve(map as unknown as ResolvedMap<K, V>);
      },
      (error) => {
        this._tombstones.clear();

        this._inflight = null;
        this.drain();

        deferred.reject(error);
      },
    );

    return deferred.promise;
  }

  private mergePartial(requestedKeys: K[], fetched: V[]): Map<K, V> {
    // state could have been cleared while the partial was in flight
    if (this._state.status !== 'resolved') {
      this._tombstones.clear();

      return new Map();
    }

    const fetchedByKey = new Map<K, V>();

    for (const item of fetched) {
      fetchedByKey.set(this._key(item), item);
    }

    const map = this._state.map;
    const suspicious: K[] = [];

    for (const key of requestedKeys) {
      if (this._tombstones.has(key)) {
        map.delete(key);
        suspicious.push(key);
        continue;
      }

      const value = fetchedByKey.get(key);

      if (value === undefined) {
        map.delete(key);
      } else {
        map.set(key, value);
      }
    }

    this._tombstones.clear();

    // one-shot retry to confirm tombstoned keys really are deleted server-side
    for (const key of suspicious) {
      this._pendingPartial.add(key);
    }

    const finalMap = this.applySort(map);

    if (this._shouldCache) {
      this._state = { status: 'resolved', map: finalMap };
    }

    return finalMap;
  }

  private buildFullMap(array: V[]): Map<K, V> {
    const sorted = this._sort ? array.toSorted(this._sort) : array;
    const map = new Map<K, V>();
    const suspicious: K[] = [];

    for (const item of sorted) {
      const key = this._key(item);

      if (this._tombstones.has(key)) {
        suspicious.push(key);
        continue;
      }

      map.set(key, item);
    }

    this._tombstones.clear();

    // one-shot retry to confirm tombstoned keys really are deleted server-side
    for (const key of suspicious) {
      this._pendingPartial.add(key);
    }

    return map;
  }

  private applySort(map: Map<K, V>): Map<K, V> {
    if (!this._sort) {
      return map;
    }

    const sorted = [...map.values()].toSorted(this._sort);
    const next = new Map<K, V>();

    for (const item of sorted) {
      next.set(this._key(item), item);
    }

    return next;
  }
}

export const createProjectedMap = <K, V>(options: ProjectedMapOptions<K, V>) => new ProjectedMap(options);
