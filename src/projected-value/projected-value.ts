import type { MaybePromise, ReadonlyDeep } from '@entwico/dash';

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
  // the latest fetch, or the clear() after it: only that fetch may write its outcome into the state
  private _fetchId = 0;

  constructor({ value, cache }: ProjectedValueOptions<V>) {
    this.valueFn = value;
    this.shouldCache = cache ?? true;
  }

  private fetch(): Promise<ReadonlyDeep<V>> {
    const promise = this.fetchValue();

    this._state = { status: 'pending', promise };

    return promise;
  }

  private triggerBackgroundRefresh(staleValue?: ReadonlyDeep<V>): Promise<ReadonlyDeep<V>> {
    const promise = this.fetchValue(staleValue);

    this._state = staleValue === undefined
      ? { status: 'pending', promise }
      : { status: 'refreshing', value: staleValue, promise };

    return promise;
  }

  private async fetchValue(staleValue?: ReadonlyDeep<V>): Promise<ReadonlyDeep<V>> {
    const fetchId = ++this._fetchId;

    try {
      // Promise.try converts a synchronous throw into a rejection, so the catch below
      // runs only after the caller has assigned the pending/refreshing state
      const value = (await Promise.try(() => this.valueFn())) as ReadonlyDeep<V>;

      if (fetchId === this._fetchId) {
        this._state = this.shouldCache ? { status: 'resolved', value } : { status: 'empty' };
      }

      return value;
    } catch (error) {
      if (fetchId === this._fetchId) {
        this._state = staleValue !== undefined && this.shouldCache
          ? { status: 'resolved', value: staleValue }
          : { status: 'empty' };
      }

      throw error;
    }
  }

  /**
   * Get the value
   * @returns Value (sync if cached) or Promise that resolves to a value (async if fetching)
   */
  get(): MaybePromise<ReadonlyDeep<V>> {
    const state = this._state;

    if (state.status === 'resolved' || state.status === 'refreshing') {
      return state.value;
    }

    if (state.status === 'pending') {
      return state.promise;
    }

    return this.fetch();
  }

  /**
   * Clear the value, so it will be fetched again on the next access
   * @returns void
   */
  clear() {
    this._fetchId++;
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

    if (state.status === 'refreshing') {
      return state.promise;
    }

    if (state.status === 'empty' || state.status === 'pending') {
      return this.triggerBackgroundRefresh();
    }

    return this.triggerBackgroundRefresh(state.value);
  }
}

export const createProjectedValue = <V>(options: ProjectedValueOptions<V>) => new ProjectedValue(options);
