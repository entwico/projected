import type { ProjectedMapCache } from '../types/cache.js';
import type { MaybePromise } from '../types/maybe-promise.js';
import type { Maybe } from '../types/maybe.js';
import type { Protection } from '../types/protection.js';
import { deepFreeze } from '../utils/deep-freeze.js';
import { defined } from '../utils/defined.js';
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

  /**
   * Should the values be protected from modification
   * - 'freeze' - values are deeply frozen
   * - 'none' - values are not protected
   * @default 'none'
   */
  protection?: Maybe<Protection>;
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
  private readonly protection: Maybe<Protection>;

  constructor({ cache, protection, ...fetcherOptions }: ProjectedLazyMapOptions<K, V>) {
    this.fetcher = new Resolver(fetcherOptions);
    this.protection = protection ?? 'none';

    if (cache === false) {
      this.cache = NOOP_CACHE;
    } else if (typeof cache === 'object') {
      this.cache = cache;
    }
  }

  /**
   * Get values by keys, but return `undefined` for missing keys
   * @param keys Array of keys
   * @returns Array of values (sync if all cached) or Promise that resolves to an array
   */
  getByKeysSparse(keys: K[]): MaybePromise<Maybe<V>[]> {
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
      return keys.map((key) => foundMap.get(key));
    }

    // need to fetch missing keys
    return this.fetcher.resolve(missingKeys).then((fetchedMap) => {
      fetchedMap.forEach((value, valueKey) => {
        if (!value) {
          return;
        }

        if (this.protection === 'freeze') {
          deepFreeze(value);
        }

        foundMap.set(valueKey, value);
        this.cache.set(valueKey, value);
      });

      return keys.map((key) => foundMap.get(key));
    });
  }

  /**
   * Fetch many values by keys
   * @param keys Array of keys
   * @returns Array of values (sync if all cached) or Promise that resolves to an array
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
    const hit = this.cache.get(key);

    if (hit) {
      return hit;
    }

    return this.fetcher.resolve([key]).then((fetchedMap) => {
      const value = fetchedMap.get(key);

      if (value) {
        if (this.protection === 'freeze') {
          deepFreeze(value);
        }

        this.cache.set(key, value);
      }

      return value;
    });
  }

  get(keyOrKeys: K[], options?: GetOptions): MaybePromise<V[]>;
  get(keyOrKeys: K, options?: GetOptions): MaybePromise<Maybe<V>>;

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

  refresh(key: K): Promise<Maybe<V>>;
  refresh(keys: K[]): Promise<Maybe<V>[]>;

  /**
   * Refresh value(s) using stale-while-revalidate pattern.
   * - Triggers a background refresh for the specified key(s)
   * - Updates cache entries only when refresh succeeds
   * - On refresh error, keeps serving the stale values
   * @param keyOrKeys Key or array of keys to refresh
   * @returns Promise that resolves to the fresh value(s), or rejects on error
   */
  async refresh(keyOrKeys: K | K[]): Promise<Maybe<V> | Maybe<V>[]> {
    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];

    const fetchedMap = await this.fetcher.resolve(keys);

    fetchedMap.forEach((value, valueKey) => {
      if (!value) {
        return;
      }

      if (this.protection === 'freeze') {
        deepFreeze(value);
      }

      this.cache.set(valueKey, value);
    });

    const values = keys.map((key) => fetchedMap.get(key));

    if (Array.isArray(keyOrKeys)) {
      return values;
    }

    return values[0];
  }
}

export const createProjectedLazyMap = <K, V>(options: ProjectedLazyMapOptions<K, V>) => new ProjectedLazyMap(options);
