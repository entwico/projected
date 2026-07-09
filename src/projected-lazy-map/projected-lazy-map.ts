import { type MaybePromise, type ReadonlyDeep, defined, maybeThen } from '@entwico/dash';

import type { ProjectedMapCache } from '../types/cache.js';
import type { Maybe } from '../types/maybe.js';
import { NOOP_CACHE } from '../utils/noop-cache.js';

import { Resolver, type ResolverOptions } from './dispatcher.js';

export type ProjectedLazyMapOptions<K, V> = ResolverOptions<K, V> & {
  /**
   * Cache implementation (optional)
   * - false - no cache
   * - true - use default cache (`new Map()`)
   * - custom cache implementation
   * @default true
   */
  cache?: boolean | ProjectedMapCache<K, V>;
};

interface GetOptions {
  immediate?: boolean;
}

/**
 * A collection of objects that are not stored in memory, but are fetched from a remote source when needed.
 * This is useful when you have a large collection of objects that you don't want to load all at once.
 */
export class ProjectedLazyMap<K, V> {
  private readonly cache: ProjectedMapCache<K, V> = new Map();
  private readonly fetcher: Resolver<K, V>;

  constructor({ cache, ...fetcherOptions }: ProjectedLazyMapOptions<K, V>) {
    this.fetcher = new Resolver(fetcherOptions);

    if (cache === false) {
      this.cache = NOOP_CACHE;
    } else if (typeof cache === 'object') {
      this.cache = cache;
    }
  }

  private async fetchMissing(
    keys: readonly K[],
    missingKeys: K[],
    foundMap: Map<K, V>,
  ): Promise<ReadonlyArray<Maybe<ReadonlyDeep<V>>>> {
    const fetchedMap = await this.fetcher.resolve(missingKeys);

    fetchedMap.forEach((value, valueKey) => {
      if (!value) {
        return;
      }

      foundMap.set(valueKey, value);
      this.cache.set(valueKey, value);
    });

    return keys.map((key) => foundMap.get(key) as ReadonlyDeep<V> | undefined);
  }

  private async fetchByKey(key: K): Promise<Maybe<ReadonlyDeep<V>>> {
    const fetchedMap = await this.fetcher.resolve([key]);
    const value = fetchedMap.get(key);

    if (value) {
      this.cache.set(key, value);
    }

    return value as ReadonlyDeep<V> | undefined;
  }

  /**
   * Get values by keys, but return `undefined` for missing keys
   * @param keys Array of keys
   * @returns Array of values (sync if all cached) or Promise that resolves to an array
   */
  getByKeysSparse(keys: readonly K[]): MaybePromise<ReadonlyArray<Maybe<ReadonlyDeep<V>>>> {
    if (keys.length === 0) {
      return [];
    }

    const foundMap = new Map<K, V>();
    const missingKeys: K[] = [];

    for (const key of keys) {
      const hit = this.cache.get(key);

      if (hit) {
        foundMap.set(key, hit);
      } else {
        missingKeys.push(key);
      }
    }

    // all cached - return sync
    if (missingKeys.length === 0) {
      return keys.map((key) => foundMap.get(key) as ReadonlyDeep<V> | undefined);
    }

    return this.fetchMissing(keys, missingKeys, foundMap);
  }

  /**
   * Fetch many values by keys
   * @param keys Array of keys
   * @returns Array of values (sync if all cached) or Promise that resolves to an array
   */
  getByKeys(keys: readonly K[]): MaybePromise<ReadonlyArray<ReadonlyDeep<V>>> {
    return maybeThen(this.getByKeysSparse(keys), (values) => values.filter(defined));
  }

  /**
   * Get value by key
   * @param key Key
   * @returns Value (sync if cached) or Promise that resolves to a value
   */
  getByKey(key: K): MaybePromise<Maybe<ReadonlyDeep<V>>> {
    const hit = this.cache.get(key);

    if (hit) {
      return hit as ReadonlyDeep<V>;
    }

    return this.fetchByKey(key);
  }

  get(keyOrKeys: readonly K[], options?: GetOptions): MaybePromise<ReadonlyArray<ReadonlyDeep<V>>>;
  get(keyOrKeys: K, options?: GetOptions): MaybePromise<Maybe<ReadonlyDeep<V>>>;

  /**
   * Mixed get method
   * @param keyOrKeys Key or array of keys
   * @returns Value or array of values (sync if cached) or Promise
   */
  get(
    keyOrKeys: K | readonly K[],
  ): MaybePromise<ReadonlyArray<ReadonlyDeep<V>> | Maybe<ReadonlyDeep<V>>> {
    if (Array.isArray(keyOrKeys)) {
      return this.getByKeys(keyOrKeys as readonly K[]);
    }

    return this.getByKey(keyOrKeys as K);
  }

  /**
   * Delete value by key
   * @param key Key
   * @param value Value
   * @returns void
   */
  delete(keyOrKeys: K | K[]) {
    if (Array.isArray(keyOrKeys)) {
      keyOrKeys.forEach((key) => this.cache.delete(key));

      return;
    }

    this.cache.delete(keyOrKeys);
  }

  /**
   * Clear cache
   * @returns void
   */
  clear() {
    this.cache.clear();
  }

  refresh(key: K): Promise<Maybe<ReadonlyDeep<V>>>;
  refresh(keys: K[]): Promise<ReadonlyArray<Maybe<ReadonlyDeep<V>>>>;

  /**
   * Refresh value(s) for the given key(s).
   *
   * - Triggers a fetch for the specified key(s) via the resolver.
   * - For each requested key:
   *   - if the result contains it, the cache entry is updated.
   *   - if the result does not contain it (server says it no longer exists),
   *     the cache entry is **evicted**.
   * - On fetch error, cache entries are left untouched (stale stays stale) and the
   *   returned promise rejects.
   *
   * @param keyOrKeys Key or array of keys to refresh
   * @returns Promise that resolves to the fresh value(s), or rejects on error
   */
  async refresh(
    keyOrKeys: K | K[],
  ): Promise<Maybe<ReadonlyDeep<V>> | ReadonlyArray<Maybe<ReadonlyDeep<V>>>> {
    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];

    if (keys.length === 0) {
      return [];
    }

    const fetchedMap = await this.fetcher.resolve(keys);

    for (const key of keys) {
      const value = fetchedMap.get(key);

      if (value === undefined) {
        this.cache.delete(key);
        continue;
      }

      this.cache.set(key, value);
    }

    const values = keys.map((key) => fetchedMap.get(key) as ReadonlyDeep<V> | undefined);

    if (Array.isArray(keyOrKeys)) {
      return values;
    }

    return values[0];
  }
}

export const createProjectedLazyMap = <K, V>(options: ProjectedLazyMapOptions<K, V>) => new ProjectedLazyMap(options);
