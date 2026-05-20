import type { MaybePromise } from '../types/maybe-promise.js';
import type { Maybe } from '../types/maybe.js';
import type { Protection } from '../types/protection.js';
import { deepFreeze } from '../utils/deep-freeze.js';
import { defined } from '../utils/defined.js';

type CacheState<K, V> =
  | { status: 'empty' }
  | { status: 'pending'; promise: Promise<Map<K, V>> }
  | { status: 'resolved'; map: Map<K, V> }
  | { status: 'refreshing'; map: Map<K, V>; promise: Promise<Map<K, V>> };

export type ProjectedMapOptions<K, V> = {
  /**
   * Function that returns key of an entity
   * If not provided, the entity is expected to have `key` property
   * @param item Entity
   * @returns Key of the entity
   */
  key: (item: V) => K;

  /**
   * Function that fetches all entities
   * @returns Promise that resolves to an array of entities
   */
  values: () => MaybePromise<V[]>;

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
 * A collection of objects that are stored in memory, but being fetched from a remote source on demand.
 * This is useful when you have a fairly small collection of objects that you need to fetch and actualize
 * from the remote data source.
 */
export class ProjectedMap<K, V> {
  private _state: CacheState<K, V> = { status: 'empty' };
  private readonly key: (item: V) => K;
  private readonly values: ProjectedMapOptions<K, V>['values'];
  private readonly protection: Maybe<Protection>;
  private readonly shouldCache: boolean;

  constructor({ key, values, protection, cache }: ProjectedMapOptions<K, V>) {
    this.key = key;
    this.values = values;
    this.protection = protection ?? 'none';
    this.shouldCache = cache ?? true;
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
   * Get all values as an array (the order is preserved)
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
   * Clear the values, so they will be fetched again on the next access
   * @returns void
   */
  clear() {
    this._state = { status: 'empty' };
  }

  /**
   * Refresh the values using stale-while-revalidate pattern.
   * - Triggers a background refresh
   * - Replaces cached map only when refresh succeeds
   * - On refresh error, keeps serving the stale map
   * @returns Promise that resolves to the fresh map, or rejects on error
   */
  refresh(): Promise<Map<K, V>> {
    const state = this._state;

    // already refreshing - return existing promise
    if (state.status === 'refreshing') {
      return state.promise;
    }

    // nothing cached or still pending
    if (state.status === 'empty' || state.status === 'pending') {
      return this.triggerBackgroundRefresh();
    }

    // have cached map - trigger refresh
    return this.triggerBackgroundRefresh(state.map);
  }

  private getCache(): MaybePromise<Map<K, V>> {
    const state = this._state;

    // cache hit - return sync
    if (state.status === 'resolved' || state.status === 'refreshing') {
      return state.map;
    }

    // already fetching - return existing promise
    if (state.status === 'pending') {
      return state.promise;
    }

    // cache miss - fetch
    return this.fetch();
  }

  private fetch(): Promise<Map<K, V>> {
    const promise = Promise.resolve()
      .then(() => this.values())
      .then((array) => this.arrayToMap(array))
      .then((map) => {
        this._state = this.shouldCache ? { status: 'resolved', map } : { status: 'empty' };

        return map;
      })
      .catch((error) => {
        this._state = { status: 'empty' };

        throw error;
      });

    this._state = { status: 'pending', promise };

    return promise;
  }

  private triggerBackgroundRefresh(staleMap?: Map<K, V>): Promise<Map<K, V>> {
    const promise = Promise.resolve()
      .then(() => this.values())
      .then((array) => this.arrayToMap(array))
      .then((map) => {
        this._state = this.shouldCache ? { status: 'resolved', map } : { status: 'empty' };

        return map;
      })
      .catch((error) => {
        // on error, keep stale map if we have one
        this._state = staleMap && this.shouldCache ? { status: 'resolved', map: staleMap } : { status: 'empty' };

        throw error;
      });

    this._state = staleMap ? { status: 'refreshing', map: staleMap, promise } : { status: 'pending', promise };

    return promise;
  }

  private arrayToMap(array: V[]): Map<K, V> {
    return array.reduce(
      (map, item) => map.set(this.key(item), this.protection === 'freeze' ? deepFreeze(item) : item),
      new Map<K, V>(),
    );
  }
}

export const createProjectedMap = <K, V>(options: ProjectedMapOptions<K, V>) => new ProjectedMap(options);
