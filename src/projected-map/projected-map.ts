import type { MaybePromise } from '../types/maybe-promise.js';
import type { Maybe } from '../types/maybe.js';
import type { Protection } from '../types/protection.js';
import { deepFreeze } from '../utils/deep-freeze.js';
import { Deferred } from '../utils/deferred.js';
import { defined } from '../utils/defined.js';

type CacheState<K, V> =
  | { status: 'empty' }
  | { status: 'pending'; promise: Promise<Map<K, V>> }
  | { status: 'resolved'; map: Map<K, V> };

type Inflight<K, V> =
  | { type: 'full'; promise: Promise<Map<K, V>> }
  | { type: 'partial'; promise: Promise<Map<K, V>> };

export type ProjectedMapOptions<K, V> = {
  /**
   * Function that returns key of an entity
   * @param item Entity
   * @returns Key of the entity
   */
  key: (item: V) => K;

  /**
   * Fetches values.
   * - When called with `undefined`, must return the full collection (full refresh).
   * - When called with a non-empty `keys` array, may return only the requested entries
   *   (efficient partial refresh) OR may return more — the map only merges entries whose
   *   key is in the requested set. For any requested key missing from the result, the
   *   entry is deleted from the cached map.
   *
   * Internally the map only invokes this with `undefined` (for full refresh / initial fetch)
   * or with a non-empty array (for partial refresh). It is never called with `[]`.
   *
   * @param keys Either `undefined` (fetch all) or a non-empty array of keys to fetch.
   * @returns Array of entities (may be sync or a promise).
   */
  values: (keys: K[] | undefined) => MaybePromise<V[]>;

  /**
   * Optional sort applied to every materialization — both full refresh and partial merge.
   * When omitted, items keep the order returned by `values()` (full refresh) or stay in
   * their existing position with newly-added items appended at the end (partial refresh).
   */
  sort?: Maybe<(a: V, b: V) => number>;

  /**
   * Should the values in cache be protected from modification
   * - 'freeze' - values are deeply frozen
   * - 'none' - values are not protected
   * @default 'none'
   */
  protection?: Maybe<Protection>;

  /**
   * Cache implementation (optional)
   * - false - no cache
   * - true - use default cache
   * @default true
   */
  cache?: boolean;
};

/**
 * Default debounce window in ms for coalescing rapid `refresh(keys)` calls into one fetch.
 * Mirrors the `Resolver` default in dispatcher.ts so behavior feels consistent across maps.
 */
const PARTIAL_REFRESH_DEBOUNCE_MS = 50;

/**
 * A collection of objects that are stored in memory, but being fetched from a remote source on demand.
 * This is useful when you have a fairly small collection of objects that you need to fetch and actualize
 * from the remote data source.
 */
export class ProjectedMap<K, V> {
  private _state: CacheState<K, V> = { status: 'empty' };
  private readonly _key: (item: V) => K;
  private readonly _values: ProjectedMapOptions<K, V>['values'];
  private readonly _sort: Maybe<(a: V, b: V) => number>;
  private readonly _protection: Maybe<Protection>;
  private readonly _shouldCache: boolean;

  // refresh state machine
  private _inflight: Inflight<K, V> | null = null;
  private _pendingFull = false;
  private _pendingPartial = new Set<K>();
  private _pendingDeferred: Deferred<Map<K, V>> | null = null;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor({ key, values, sort, protection, cache }: ProjectedMapOptions<K, V>) {
    this._key = key;
    this._values = values;
    this._sort = sort;
    this._protection = protection ?? 'none';
    this._shouldCache = cache ?? true;
  }

  /**
   * Get all values as a map
   * @returns Map of all values (sync if cached) or Promise that resolves to a map
   */
  getAllAsMap(): MaybePromise<Map<K, V>> {
    const cache = this.getCache();

    if (cache instanceof Promise) {
      return cache.then((map) => new Map(map));
    }

    return new Map(cache);
  }

  /**
   * Get all values as an array. Iteration order follows `sort` when configured,
   * otherwise the order returned by the last full `values()` call, with any keys
   * added via partial refresh appended at the end.
   * @returns Array of values (sync if cached) or Promise that resolves to an array
   */
  getAll(): MaybePromise<V[]> {
    const cache = this.getCache();

    if (cache instanceof Promise) {
      return cache.then((map) => [...map.values()]);
    }

    return [...cache.values()];
  }

  /**
   * Get values by keys, but return `undefined` for missing keys
   * @param keys Array of keys
   * @returns Array of values (sync if cached) or Promise that resolves to an array
   */
  getByKeysSparse(keys: K[]): MaybePromise<Maybe<V>[]> {
    if (keys.length === 0) {
      return [];
    }

    const cache = this.getCache();

    if (cache instanceof Promise) {
      return cache.then((map) => keys.map((id) => map.get(id)));
    }

    return keys.map((id) => cache.get(id));
  }

  /**
   * Fetch many values by keys
   * @param keys Array of keys
   * @returns Array of values (sync if cached) or Promise that resolves to an array
   */
  getByKeys(keys: K[]): MaybePromise<V[]> {
    const sparse = this.getByKeysSparse(keys);

    if (sparse instanceof Promise) {
      return sparse.then((values) => values.filter(defined));
    }

    return sparse.filter(defined);
  }

  /**
   * Get value by key
   * @param key Key
   * @returns Value (sync if cached) or Promise that resolves to a value
   */
  getByKey(key: K): MaybePromise<Maybe<V>> {
    const cache = this.getCache();

    if (cache instanceof Promise) {
      return cache.then((map) => map.get(key));
    }

    return cache.get(key);
  }

  get(keyOrKeys: K[]): MaybePromise<V[]>;
  get(keyOrKeys: K): MaybePromise<Maybe<V>>;

  /**
   * Mixed get method
   * @param keyOrKeys Key or array of keys
   * @returns Value or array of values (sync if cached) or Promise
   */
  get(keyOrKeys: K | K[]): MaybePromise<V[] | Maybe<V>> {
    if (Array.isArray(keyOrKeys)) {
      return this.getByKeys(keyOrKeys);
    }

    return this.getByKey(keyOrKeys);
  }

  /**
   * Delete entries locally. Does not trigger any fetch.
   * No-op when the map has not been resolved yet.
   * @param keyOrKeys Single key or array of keys
   */
  delete(keyOrKeys: K | K[]): void {
    if (this._state.status !== 'resolved') {
      return;
    }

    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];

    for (const key of keys) {
      this._state.map.delete(key);
    }
  }

  /**
   * Clear the values, so they will be fetched again on the next access
   * @returns void
   */
  clear() {
    this._state = { status: 'empty' };
  }

  refresh(): Promise<Map<K, V>>;
  refresh(keyOrKeys: K | K[]): Promise<Map<K, V>>;

  /**
   * Refresh values using stale-while-revalidate pattern.
   *
   * - `refresh()` triggers a full re-fetch via `values(undefined)`.
   * - `refresh(key)` and `refresh(keys)` trigger a partial re-fetch via `values(keys)`,
   *   merging the result into the resolved map. Any requested key missing from the result
   *   is deleted from the map.
   * - `refresh([])` is treated as a full refresh.
   * - `refresh(keys)` against a map that has not been resolved yet (no full fetch has
   *   completed) falls back to a full refresh — there is no resolved map to merge into.
   *
   * Coalescing rules across concurrent calls:
   * - Rapid `refresh(keys)` calls within a short debounce window are merged into one fetch.
   * - If a full refresh is requested while a partial is in flight (or vice versa), the
   *   second op is queued and runs once the first completes.
   * - A queued full refresh subsumes any queued partial keys — they are dropped.
   *
   * On error, the stale resolved map is preserved and the returned promise rejects.
   *
   * @returns Promise that resolves to the post-operation resolved map.
   */
  refresh(keyOrKeys?: K | K[]): Promise<Map<K, V>> {
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

  private getCache(): MaybePromise<Map<K, V>> {
    const state = this._state;

    if (state.status === 'resolved') {
      return state.map;
    }

    if (state.status === 'pending') {
      return state.promise;
    }

    // empty - trigger initial fetch via the full path
    return this.scheduleFull();
  }

  // ---------------------------------------------------------------------------
  // refresh state machine
  // ---------------------------------------------------------------------------

  private scheduleFull(): Promise<Map<K, V>> {
    // a full refresh is already in flight — reuse its promise
    if (this._inflight?.type === 'full') {
      return this._inflight.promise;
    }

    // a partial is in flight: queue full, drop any pending partial keys
    if (this._inflight?.type === 'partial') {
      this._pendingFull = true;
      this._pendingPartial.clear();
      this.clearDebounce();

      return this.getOrCreatePendingDeferred().promise;
    }

    // nothing in flight: start full immediately
    this.clearDebounce();
    this._pendingPartial.clear();
    this._pendingFull = false;

    return this.startFull();
  }

  private schedulePartial(keys: K[]): Promise<Map<K, V>> {
    // no resolved map to patch into — fall back to full
    if (this._state.status !== 'resolved') {
      return this.scheduleFull();
    }

    // a full refresh is in flight or queued — partial is subsumed
    if (this._inflight?.type === 'full') {
      return this._inflight.promise;
    }

    if (this._pendingFull) {
      return this.getOrCreatePendingDeferred().promise;
    }

    // queue keys
    for (const key of keys) {
      this._pendingPartial.add(key);
    }

    const deferred = this.getOrCreatePendingDeferred();

    // a partial is in flight — drain will pick up the queued keys when it completes
    if (this._inflight?.type === 'partial') {
      return deferred.promise;
    }

    // nothing in flight — schedule debounced dispatch
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

  private getOrCreatePendingDeferred(): Deferred<Map<K, V>> {
    if (this._pendingDeferred === null) {
      this._pendingDeferred = new Deferred<Map<K, V>>();
    }

    return this._pendingDeferred;
  }

  private startFull(): Promise<Map<K, V>> {
    const deferred = this._pendingDeferred ?? new Deferred<Map<K, V>>();

    this._pendingDeferred = null;

    const promise = Promise.resolve()
      // eslint-disable-next-line unicorn/no-useless-undefined
      .then(() => this._values(undefined))
      .then((array) => this.arrayToMap(array));

    this._inflight = { type: 'full', promise: deferred.promise };

    // if state was empty, transition to pending so concurrent gets can join
    if (this._state.status === 'empty') {
      this._state = { status: 'pending', promise: deferred.promise };
    }

    promise.then(
      (map) => {
        this._state = this._shouldCache ? { status: 'resolved', map } : { status: 'empty' };

        // clear inflight + drain BEFORE resolving deferred so that any caller
        // awaiting this promise observes the post-op state when they continue.
        this._inflight = null;
        this.drain();

        deferred.resolve(map);
      },
      (error) => {
        // keep stale on error; if there was no stale (state still pending), reset to empty
        if (this._state.status === 'pending') {
          this._state = { status: 'empty' };
        }

        this._inflight = null;
        this.drain();

        deferred.reject(error);
      },
    );

    return deferred.promise;
  }

  private startPartial(): Promise<Map<K, V>> {
    const deferred = this._pendingDeferred ?? new Deferred<Map<K, V>>();

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

        deferred.resolve(map);
      },
      (error) => {
        this._inflight = null;
        this.drain();

        deferred.reject(error);
      },
    );

    return deferred.promise;
  }

  private mergePartial(requestedKeys: K[], fetched: V[]): Map<K, V> {
    // defensive: state could have been cleared while partial was in flight
    if (this._state.status !== 'resolved') {
      return new Map();
    }

    const fetchedByKey = new Map<K, V>();

    for (const item of fetched) {
      fetchedByKey.set(this._key(item), item);
    }

    const map = this._state.map;

    for (const key of requestedKeys) {
      const value = fetchedByKey.get(key);

      if (value === undefined) {
        map.delete(key);
      } else {
        map.set(key, this._protection === 'freeze' ? deepFreeze(value) : value);
      }
    }

    const finalMap = this.applySort(map);

    if (this._shouldCache) {
      this._state = { status: 'resolved', map: finalMap };
    }

    return finalMap;
  }

  private arrayToMap(array: V[]): Map<K, V> {
    const sorted = this._sort ? array.toSorted(this._sort) : array;

    return sorted.reduce(
      (map, item) => map.set(this._key(item), this._protection === 'freeze' ? deepFreeze(item) : item),
      new Map<K, V>(),
    );
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
