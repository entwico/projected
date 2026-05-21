import type { MaybePromise } from '../types/maybe-promise.js';
import type { ReadonlyDeep } from '../types/readonly-deep.js';

type CacheState<V> =
  | { status: 'empty' }
  | { status: 'pending'; promise: Promise<ReadonlyDeep<V>> }
  | { status: 'resolved'; value: ReadonlyDeep<V> }
  | { status: 'refreshing'; value: ReadonlyDeep<V>; promise: Promise<ReadonlyDeep<V>> };

export type ProjectedValueOptions<V> = {
  /**
   * Function that fetches a value
   * @returns Promise that resolves to a value
   */
  value: () => MaybePromise<V>;

  /**
   * Cache implementation (optional)
   * - false - no cache
   * - true - use default cache
   * @default true
   */
  cache?: boolean;
};

/**
 * A value being fetched from a remote source on demand.
 * This is useful when you have a single value that is expensive to fetch and you want to fetch it only
 * when it is needed.
 */
export class ProjectedValue<V> {
  private _state: CacheState<V> = { status: 'empty' };
  private readonly valueFn: ProjectedValueOptions<V>['value'];
  private readonly shouldCache: boolean;

  constructor({ value, cache }: ProjectedValueOptions<V>) {
    this.valueFn = value;
    this.shouldCache = cache ?? true;
  }

  /**
   * Get the value
   * @returns Value (sync if cached) or Promise that resolves to a value (async if fetching)
   */
  get(): MaybePromise<ReadonlyDeep<V>> {
    const state = this._state;

    // cache hit - return sync
    if (state.status === 'resolved' || state.status === 'refreshing') {
      return state.value;
    }

    // already fetching - return existing promise
    if (state.status === 'pending') {
      return state.promise;
    }

    // cache miss - fetch
    return this.fetch();
  }

  /**
   * Clear the value, so it will be fetched again on the next access
   * @returns void
   */
  clear() {
    this._state = { status: 'empty' };
  }

  /**
   * Refresh the value using stale-while-revalidate pattern.
   * - Triggers a background refresh
   * - Replaces cached value only when refresh succeeds
   * - On refresh error, keeps serving the stale value
   * @returns Promise that resolves to the fresh value, or rejects on error
   */
  refresh(): Promise<ReadonlyDeep<V>> {
    const state = this._state;

    // already refreshing - return existing promise
    if (state.status === 'refreshing') {
      return state.promise;
    }

    // nothing cached or still pending
    if (state.status === 'empty' || state.status === 'pending') {
      return this.triggerBackgroundRefresh();
    }

    // have cached value - trigger refresh
    return this.triggerBackgroundRefresh(state.value);
  }

  private fetch(): Promise<ReadonlyDeep<V>> {
    const promise = Promise.resolve()
      .then(() => this.valueFn())
      .then((v) => {
        const value = v as ReadonlyDeep<V>;

        this._state = this.shouldCache ? { status: 'resolved', value } : { status: 'empty' };

        return value;
      })
      .catch((error) => {
        this._state = { status: 'empty' };

        throw error;
      });

    this._state = { status: 'pending', promise };

    return promise;
  }

  private triggerBackgroundRefresh(staleValue?: ReadonlyDeep<V>): Promise<ReadonlyDeep<V>> {
    const promise = Promise.resolve()
      .then(() => this.valueFn())
      .then((v) => {
        const value = v as ReadonlyDeep<V>;

        this._state = this.shouldCache ? { status: 'resolved', value } : { status: 'empty' };

        return value;
      })
      .catch((error) => {
        // on error, keep stale value if we have one
        this._state = staleValue !== undefined && this.shouldCache
          ? { status: 'resolved', value: staleValue }
          : { status: 'empty' };

        throw error;
      });

    this._state = staleValue === undefined
      ? { status: 'pending', promise }
      : { status: 'refreshing', value: staleValue, promise };

    return promise;
  }
}

export const createProjectedValue = <V>(options: ProjectedValueOptions<V>) => new ProjectedValue(options);
