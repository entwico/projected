import type { MaybePromise } from '@entwico/dash';

import type { Maybe } from '../types/maybe.js';
import { Deferred } from '../utils/deferred.js';

export type ResolverOptions<K, V> = {
  /**
   * Function that returns key of an entity
   * @param item Entity
   * @returns Key of the entity
   */
  key: (item: V) => K;

  /**
   * Fetches values for the given keys. Always invoked with a non-empty `keys` array — the
   * dispatcher never calls this with an empty array.
   *
   * Return only the entities that exist. Any requested key that does not appear in the
   * result is treated as missing — for `refresh()` callers, missing keys are evicted from
   * the cache.
   *
   * A consumer who wants to share one fetcher between this and `ProjectedMap` can widen the
   * parameter type to `K[] | undefined` (functions accepting a wider input are assignable
   * here via parameter contravariance).
   *
   * @param keys Non-empty array of keys to fetch.
   * @returns Array of entities (may be sync or a promise).
   */
  values: (keys: K[]) => MaybePromise<V[]>;

  /**
   * Delay in ms that is used to buffer requests
   * @default 50
   */
  delay?: number;

  /**
   * Maximum number of keys that can be buffered
   * @default 1000
   */
  maxChunkSize?: number;
};

class ConsumerMap<K, V> extends Map<K, ConsumerValue<V>> {}
type ConsumerValue<V> = { value: Maybe<V> } | { error: any };
type Consumer<K, V> = (values: ConsumerMap<K, Maybe<V>>) => void;

/**
 * Utility class that helps to reduce the number of requests to the backend.
 */
export class Resolver<K, V> {
  private readonly values: (keys: K[]) => MaybePromise<V[]>;
  private readonly key: (item: V) => K;
  private readonly delay: number;
  private readonly maxChunkSize: number;

  private readonly queue = new Set<K>();

  private timeout: any | null = null;

  private consumers = new Set<Consumer<K, V>>();

  constructor(options: ResolverOptions<K, V>) {
    const { values, key, delay, maxChunkSize } = options;

    this.values = values;
    this.key = key;
    this.delay = delay ?? 50;
    this.maxChunkSize = maxChunkSize ?? 1000;
  }

  private enqueue(keys: K[]) {
    // if present, the key will remain on the same position in the queue even if it is added multiple times
    keys.forEach((key) => this.queue.add(key));
  }

  private async schedule() {
    // if the buffer is full, dispatch immediately
    while (this.queue.size > this.maxChunkSize) {
      this.clearTimer();
      await this.dispatch();
    }

    // already scheduled
    if (this.timeout) {
      return;
    }

    this.timeout = setTimeout(async () => {
      this.clearTimer();
      await this.dispatch();
    }, this.delay);
  }

  private async dispatch() {
    // get relevant chunk of keys from the queue
    const keys = [...this.queue].slice(0, this.maxChunkSize);

    if (keys.length === 0) {
      return;
    }

    // remove dispatched keys from the queue
    keys.forEach((key) => this.queue.delete(key));

    const results = new ConsumerMap<K, V>(keys.map((key) => [key, { value: undefined }]));

    try {
      const values = await this.values(keys);

      values.forEach((value) => {
        const key = this.key(value);

        results.set(key, { value });
      });
    } catch (error) {
      results.forEach((_, key) => results.set(key, { error }));
    }

    this.consumers.forEach((consume) => consume(results));
  }

  private clearTimer() {
    if (!this.timeout) {
      return;
    }

    clearTimeout(this.timeout);
    this.timeout = null;
  }

  async resolve(keys: K[]): Promise<Map<K, Maybe<V>>> {
    const deferred = new Deferred<Map<K, Maybe<V>>>();

    const pending = new Set(keys);
    const resolved = new Map<K, Maybe<V>>();

    const consume: Consumer<K, V> = (results) => {
      results.forEach((value, key) => {
        if ('error' in value) {
          this.consumers.delete(consume);
          deferred.reject(value.error);
          return;
        }

        resolved.set(key, value.value);
        pending.delete(key);
      });

      if (pending.size === 0) {
        this.consumers.delete(consume);
        deferred.resolve(resolved);
      }
    };

    this.consumers.add(consume);
    this.enqueue(keys);
    this.schedule();

    return deferred.promise;
  }
}
